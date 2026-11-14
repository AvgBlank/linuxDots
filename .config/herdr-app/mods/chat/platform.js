// What the chat needs from the desktop it runs on, for macOS and Linux:
// the clipboard, the file picker, opening a file, and an image's size.
// Each tries the macOS tool first, then the Linux ones (Wayland, then X11).
import { exec } from "herdr";

const sh = (script, ...args) => exec("sh", ["-c", script, "sh", ...args]);
// A picker waits on the person: exec's longest wait, not its 30 s default.
const shWait = (script, ...args) => exec("sh", ["-c", script, "sh", ...args], { timeout: 600_000 });

// Puts text on the clipboard; false when no clipboard tool is installed.
export async function copyText(text) {
  const r = await sh(`
    if command -v pbcopy >/dev/null 2>&1; then printf "%s" "$1" | pbcopy
    elif [ -n "$WAYLAND_DISPLAY" ] && command -v wl-copy >/dev/null 2>&1; then printf "%s" "$1" | wl-copy
    elif command -v xclip >/dev/null 2>&1; then printf "%s" "$1" | xclip -selection clipboard
    elif command -v xsel >/dev/null 2>&1; then printf "%s" "$1" | xsel --clipboard --input
    elif command -v wl-copy >/dev/null 2>&1; then printf "%s" "$1" | wl-copy
    elif q=$(command -v qdbus6 || command -v qdbus) && "$q" org.kde.klipper /klipper >/dev/null 2>&1; then "$q" org.kde.klipper /klipper setClipboardContents "$1"
    else exit 3; fi`, text);
  return r.code === 0;
}

// Saves an image on the clipboard to `path` as PNG: true, false when there's
// none, or "missing" when this desktop has no tool to read it.
export async function pasteImage(path) {
  const r = await sh(`
    if command -v osascript >/dev/null 2>&1; then
      osascript -e "set f to open for access (POSIX file \\"$1\\") with write permission" \\
        -e "write (the clipboard as «class PNGf») to f" -e "close access f" >/dev/null 2>&1
    elif command -v wl-paste >/dev/null 2>&1 && wl-paste --list-types 2>/dev/null | grep -q '^image/png'; then wl-paste --type image/png > "$1"
    elif command -v xclip >/dev/null 2>&1; then xclip -selection clipboard -t image/png -o > "$1" 2>/dev/null
    else exit 3; fi
    [ -s "$1" ]`, path);
  return r.code === 3 ? "missing" : r.code === 0;
}

// Opens a file in the desktop's default app (an image in Preview, say).
export function openFile(path) {
  return sh(`if command -v open >/dev/null 2>&1 && [ "$(uname)" = Darwin ]; then open "$1"; else xdg-open "$1" >/dev/null 2>&1 & fi`, path);
}

// The system's file picker, several files at once: their paths, [] when
// cancelled, or null when this desktop has no picker the chat can use.
export async function pickFiles(prompt = "Attach to your message") {
  const r = await shWait(`
    if command -v osascript >/dev/null 2>&1; then
      osascript -e "set fs to choose file with prompt \\"$1\\" with multiple selections allowed" \\
        -e 'set out to ""' -e 'repeat with f in fs' -e 'set out to out & POSIX path of f & linefeed' -e 'end repeat' -e 'return out'
    elif command -v kdialog >/dev/null 2>&1; then kdialog --title "$1" --getopenfilename "$HOME" --multiple --separate-output
    elif command -v zenity >/dev/null 2>&1; then zenity --file-selection --multiple --separator="
" --title="$1"
    elif command -v yad >/dev/null 2>&1; then yad --file --multiple --separator="
" --title="$1"
    else exit 3; fi; true`, prompt);
  if (r.code === 3) return null;
  return r.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
}

// An image's pixel size from its header (PNG, JPEG, GIF, WebP), with nothing
// to install: { w, h }, or null.
const SIZE = `
import struct, sys
try: b = open(sys.argv[1], "rb").read(262144)
except OSError: sys.exit(1)
def out(w, h): print(w, h); sys.exit(0)
if b[:8] == b"\\x89PNG\\r\\n\\x1a\\n": out(*struct.unpack(">II", b[16:24]))
if b[:6] in (b"GIF87a", b"GIF89a"): out(*struct.unpack("<HH", b[6:10]))
if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
    k = b[12:16]
    if k == b"VP8 ": w, h = struct.unpack("<HH", b[26:30]); out(w & 0x3fff, h & 0x3fff)
    if k == b"VP8L": v = int.from_bytes(b[21:25], "little"); out((v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1)
    if k == b"VP8X": out(int.from_bytes(b[24:27], "little") + 1, int.from_bytes(b[27:30], "little") + 1)
if b[:2] == b"\\xff\\xd8":
    i = 2
    while i + 9 < len(b):
        if b[i] != 0xFF: i += 1; continue
        m = b[i + 1]
        if 0xC0 <= m <= 0xCF and m not in (0xC4, 0xC8, 0xCC): h, w = struct.unpack(">HH", b[i + 5:i + 9]); out(w, h)
        i += 2 + struct.unpack(">H", b[i + 2:i + 4])[0]
sys.exit(1)
`;

export async function imageSize(path) {
  const r = await exec("python3", ["-c", SIZE, path]);
  const [w, h] = r.stdout.trim().split(" ").map(Number);
  return w > 0 && h > 0 ? { w, h } : null;
}
