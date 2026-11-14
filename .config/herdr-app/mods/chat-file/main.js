// A file from the chat's /memory, /config and /hooks, opened to edit: a
// dialog with the file, Save (⌘S) and Close. Props: { file, title, overlay }.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { props, theme, settings, readTextFile, writeTextFile, closeOverlay, exec } from "herdr";

const LANG = { md: "markdown", json: "json", toml: "toml", js: "javascript", sh: "bash", yaml: "yaml", yml: "yaml" };

export default class ChatFile extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.file = p.file;
    this.saved = null; // the text on disk, once read (null: a new file)
    this.status = "Opening…";
    const t = theme();
    this.code = EditorState.new({
      language: LANG[this.file?.split(".").pop()] ?? "markdown", value: "", soft_wrap: true,
      font_family: settings().font_family,
      syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, number: t.ansi3, constant: t.ansi6, type: t.ansi4, function: t.ansi4 },
    });
    this.code.on("change", (_e, cx) => { this.status = this.code.value() === (this.saved ?? "") ? "" : "Edited"; cx.notify(); });
    this.handle = cx.focus_handle();
    try { cx.bind_keys([{ keystroke: "cmd-s", action: "chat_file_save", context: "ChatFile" }]); } catch {}
    cx.spawn(async (cx) => {
      const text = await readTextFile(this.file).catch(() => null);
      this.saved = text;
      this.code.set_value(text ?? "");
      this.status = text == null ? "New file" : "";
      cx.notify();
    });
  }

  save(cx) {
    const text = this.code.value();
    cx.spawn(async (cx) => {
      try {
        await exec("mkdir", ["-p", this.file.replace(/\/[^/]*$/, "")]);
        await writeTextFile(this.file, text, this.saved);
        this.saved = text;
        this.status = "Saved";
      } catch (e) {
        this.status = `Couldn't save: ${String(e?.message ?? e)}`;
      }
      cx.notify();
    });
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const btn = (id, label, action, primary) => div().id(id).px(12).py(5).rounded(7).cursor_pointer().text_size(12.5)
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .hover((s) => s.opacity(0.85)).on_click(action).child(label);
    return v_flex().id("root").size_full().bg(t.background).text_color(t.foreground).text_size(13)
      .key_context("ChatFile").track_focus(this.handle)
      .on_action("chat_file_save", (_e, cx) => this.save(cx))
      .child(h_flex().px(14).py(10).gap(10).items_center().border_b(1).border_color(t.border)
        .child(v_flex().flex_1().min_w(0)
          .child(div().font_semibold().child(p.title ?? this.file?.split("/").pop() ?? "File"))
          .child(div().text_size(11.5).text_color(t.dim).truncate().child(this.file ?? "")))
        .when(Boolean(this.status), (el) => el.child(div().text_size(12).text_color(/Couldn't/.test(this.status) ? t.blocked : t.muted).child(this.status)))
        .child(btn("close", "Close", () => closeOverlay(p.overlay)))
        .child(btn("save", "Save", (_e, cx) => this.save(cx), true)))
      .child(div().flex_1().min_h(0).child(Editor.new(this.code).size_full()));
  }
}
