#!/usr/bin/env python3
"""Compile Python rules into the selected Karabiner profile."""

import copy
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

CONFIG_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(CONFIG_DIR))

from src.rules import build_rules

CONFIG_PATH = CONFIG_DIR / "karabiner.json"
CLI_DEFAULT = "/Library/Application Support/org.pqrs/Karabiner-Elements/bin/karabiner_cli"


def resolve_cli() -> str:
    return (
        os.environ.get("KARABINER_CLI")
        or shutil.which("karabiner_cli")
        or CLI_DEFAULT
    )


def validate_rules(rules: list[dict[str, Any]]) -> None:
    if not isinstance(rules, list):
        raise TypeError("Generated rules must be a list")
    for index, rule in enumerate(rules):
        if not isinstance(rule, dict):
            raise TypeError(f"Rule {index + 1} must be an object")
    for index, rule in enumerate(rules):
        if not isinstance(rule.get("description"), str):
            raise TypeError(f"Rule {index + 1} must have a string description")
        manipulators = rule.get("manipulators")
        if not isinstance(manipulators, list) or not manipulators:
            raise ValueError(f"Rule {index + 1} has no valid manipulators list")
        for manipulator in manipulators:
            if not isinstance(manipulator, dict) or manipulator.get("type") != "basic":
                raise TypeError(f"Invalid manipulator in rule {index + 1}")
            if not isinstance(manipulator.get("from"), dict) or not isinstance(
                manipulator["from"].get("key_code"), str
            ):
                raise TypeError(f"Invalid from event in rule {index + 1}")
            if not isinstance(manipulator.get("to"), list) or not manipulator["to"]:
                raise TypeError(f"Invalid to actions in rule {index + 1}")
            if "conditions" in manipulator and not isinstance(
                manipulator["conditions"], list
            ):
                raise TypeError(f"Invalid conditions in rule {index + 1}")


def normalize_lint_copy(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: (
                {",": "comma", ";": "semicolon"}[item]
                if key == "key_code" and item in {",", ";"}
                else normalize_lint_copy(item)
            )
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [normalize_lint_copy(item) for item in value]
    return value


def lint_rules(rules: list[dict[str, Any]], cli: str) -> None:
    if not Path(cli).is_file() or not os.access(cli, os.X_OK):
        raise FileNotFoundError(f"karabiner_cli not found or not executable: {cli}")

    asset = {
        "title": "Generated Karabiner complex modifications",
        "rules": normalize_lint_copy(rules),
    }
    with tempfile.TemporaryDirectory(prefix="karabiner-lint-") as directory:
        lint_path = Path(directory) / "generated-rules.json"
        lint_path.write_text(json.dumps(asset), encoding="utf-8")
        result = subprocess.run(
            [cli, "--lint-complex-modifications", str(lint_path)],
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode:
            result.check_returncode()


def skip_whitespace(text: str, position: int) -> int:
    while position < len(text) and text[position] in " \t\r\n":
        position += 1
    return position


def object_member_spans(text: str, start: int) -> list[tuple[str, int, int]]:
    decoder = json.JSONDecoder()
    position = skip_whitespace(text, start + 1)
    members = []
    while text[position] != "}":
        key, key_end = decoder.raw_decode(text, position)
        position = skip_whitespace(text, key_end)
        if text[position] != ":":
            raise ValueError("Invalid JSON object while locating target value")
        value_start = skip_whitespace(text, position + 1)
        _, value_end = decoder.raw_decode(text, value_start)
        members.append((key, value_start, value_end))
        position = skip_whitespace(text, value_end)
        if text[position] == ",":
            position = skip_whitespace(text, position + 1)
        elif text[position] != "}":
            raise ValueError("Invalid JSON object while locating target value")
    return members


def object_member_span(text: str, start: int, wanted: str) -> tuple[int, int] | None:
    return next(
        (
            (value_start, value_end)
            for key, value_start, value_end in object_member_spans(text, start)
            if key == wanted
        ),
        None,
    )


def array_item_span(text: str, start: int, wanted_index: int) -> tuple[int, int]:
    decoder = json.JSONDecoder()
    position = skip_whitespace(text, start + 1)
    for index in range(wanted_index + 1):
        value_start = position
        _, value_end = decoder.raw_decode(text, value_start)
        if index == wanted_index:
            return value_start, value_end
        position = skip_whitespace(text, value_end)
        if text[position] != ",":
            raise IndexError(wanted_index)
        position = skip_whitespace(text, position + 1)
    raise IndexError(wanted_index)


def selected_profile_index(config: dict[str, Any]) -> int:
    profiles = config.get("profiles")
    if not isinstance(profiles, list):
        raise TypeError("Karabiner config has no profiles list")
    selected = [
        index
        for index, profile in enumerate(profiles)
        if isinstance(profile, dict) and profile.get("selected")
    ]
    if len(selected) != 1:
        raise ValueError("Expected exactly one selected Karabiner profile")
    return selected[0]


def replace_rules_text(text: str, rules: list[dict[str, Any]], profile_index: int) -> str:
    root = skip_whitespace(text, 0)
    profiles_span = object_member_span(text, root, "profiles")
    if profiles_span is None:
        raise KeyError("profiles")
    profiles_start, _ = profiles_span
    profile_start, profile_end = array_item_span(text, profiles_start, profile_index)
    profile_span = object_member_span(text, profile_start, "complex_modifications")
    replacement = json.dumps({"rules": rules}, indent=4, ensure_ascii=False)
    newline = "\r\n" if "\r\n" in text else "\n"

    if profile_span is not None:
        section_start, section_end = profile_span
        line_start = text.rfind("\n", 0, section_start) + 1
        indent = text[line_start:section_start]
        indent = indent[: len(indent) - len(indent.lstrip())]
        replacement = replacement.replace("\n", newline + indent)
        candidate = text[:section_start] + replacement + text[section_end:]
    else:
        profile, _ = json.JSONDecoder().raw_decode(text, profile_start)
        line_start = text.rfind("\n", 0, profile_start) + 1
        indent = text[line_start:profile_start]
        indent = indent[: len(indent) - len(indent.lstrip())]
        member_indent = indent + "    "
        replacement = replacement.replace("\n", newline + member_indent)
        insertion = f'"complex_modifications": {replacement}'
        if profile:
            candidate = (
                text[: profile_end - 1]
                + f",{newline}{member_indent}{insertion}{newline}{indent}"
                + text[profile_end - 1 :]
            )
        else:
            candidate = (
                text[: profile_start + 1]
                + f"{newline}{member_indent}{insertion}{newline}{indent}"
                + text[profile_end - 1 :]
            )

    json.loads(candidate)
    return candidate


def verify_only_rules_changed(
    before: dict[str, Any], after: dict[str, Any], profile_index: int, rules: list[dict[str, Any]]
) -> None:
    expected = copy.deepcopy(before)
    expected["profiles"][profile_index]["complex_modifications"] = {"rules": rules}
    if expected != after:
        raise ValueError(
            "Generated config changes fields outside selected profile complex_modifications"
        )


def generate_config(
    config_text: str, rules: list[dict[str, Any]], cli: str
) -> str:
    config = json.loads(config_text)
    if not isinstance(config, dict):
        raise TypeError("Karabiner config must be a JSON object")

    profile_index = selected_profile_index(config)
    profile = config["profiles"][profile_index]
    complex_modifications = profile.get("complex_modifications")
    if complex_modifications is not None and not isinstance(complex_modifications, dict):
        raise TypeError("Selected profile complex_modifications must be an object")

    validate_rules(rules)
    generated_rules = rules
    candidate_text = replace_rules_text(config_text, generated_rules, profile_index)
    candidate = json.loads(candidate_text)
    verify_only_rules_changed(config, candidate, profile_index, generated_rules)
    lint_rules(
        candidate["profiles"][profile_index]["complex_modifications"]["rules"], cli
    )
    return candidate_text


def replace_config_atomically(config_path: Path, candidate_text: str) -> None:
    metadata = config_path.stat()
    fd, temporary_name = tempfile.mkstemp(prefix="karabiner.json.", dir=config_path.parent)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(candidate_text.encode("utf-8"))
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary_name, stat.S_IMODE(metadata.st_mode))
        os.replace(temporary_name, config_path)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)


def main() -> None:
    rules = build_rules()
    original_text = CONFIG_PATH.read_text(encoding="utf-8")
    candidate_text = generate_config(original_text, rules, resolve_cli())
    replace_config_atomically(CONFIG_PATH, candidate_text)
    print(f"Updated {len(rules)} rules in {CONFIG_PATH}")


if __name__ == "__main__":
    try:
        main()
    except (
        OSError,
        ValueError,
        TypeError,
        KeyError,
        IndexError,
        subprocess.CalledProcessError,
    ) as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(1) from error
