"""Generic constructors for Karabiner complex modifications."""

from copy import deepcopy
from typing import Any


def key_condition(identifiers: dict[str, Any], condition_type: str = "device_unless") -> dict[str, Any]:
    return {"identifiers": [deepcopy(identifiers)], "type": condition_type}


def application_condition(
    bundle_ids: list[str], condition_type: str
) -> dict[str, Any]:
    return {"bundle_identifiers": bundle_ids[:], "type": condition_type}


def manipulator(
    from_key: str,
    from_modifiers: dict[str, Any] | None = None,
    *,
    to: list[dict[str, Any]],
    conditions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    source: dict[str, object] = {"key_code": from_key}
    if from_modifiers is not None:
        source["modifiers"] = deepcopy(from_modifiers)
    result = {"type": "basic", "from": source, "to": deepcopy(to)}
    if conditions:
        result["conditions"] = deepcopy(conditions)
    return result


def key_pair_manipulators(
    pairs: list[list[str]],
    from_modifiers: dict[str, Any] | None,
    to_modifiers: list[str] | None,
    conditions: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for source, target in pairs:
        action: dict[str, Any] = {"key_code": target}
        if to_modifiers is not None:
            action["modifiers"] = to_modifiers[:]
        result.append(
            manipulator(
                source,
                from_modifiers,
                to=[action],
                conditions=conditions,
            )
        )
    return result


def same_key_manipulators(
    keys: list[str],
    from_modifiers: dict[str, Any] | None,
    to_modifiers: list[str] | None,
    conditions: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    return key_pair_manipulators([[key, key] for key in keys], from_modifiers, to_modifiers, conditions)


def rule(description: str, manipulators: list[dict[str, Any]] | None) -> dict[str, Any]:
    return {"description": description, "manipulators": manipulators}
