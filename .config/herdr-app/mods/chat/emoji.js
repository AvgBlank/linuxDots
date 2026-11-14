import { UNICODE_NAMES } from "./emoji-names.js";

// Slack-style :shortcodes: and the emoji picker's set.
export const SHORTCODES = {
  smile: "😄", smiley: "😃", grin: "😁", grinning: "😀", joy: "😂", rofl: "🤣", sweat_smile: "😅", laughing: "😆",
  wink: "😉", blush: "😊", slightly_smiling_face: "🙂", upside_down_face: "🙃", heart_eyes: "😍", star_struck: "🤩",
  kissing_heart: "😘", yum: "😋", stuck_out_tongue: "😛", stuck_out_tongue_winking_eye: "😜", zany_face: "🤪",
  hugs: "🤗", hugging_face: "🤗", thinking_face: "🤔", thinking: "🤔", shushing_face: "🤫", zipper_mouth_face: "🤐",
  raised_eyebrow: "🤨", neutral_face: "😐", expressionless: "😑", no_mouth: "😶", smirk: "😏", unamused: "😒",
  roll_eyes: "🙄", face_with_rolling_eyes: "🙄", grimacing: "😬", relieved: "😌", pensive: "😔", sleepy: "😪",
  sleeping: "😴", mask: "😷", nerd_face: "🤓", sunglasses: "😎", confused: "😕", worried: "😟", frowning: "☹️",
  open_mouth: "😮", astonished: "😲", flushed: "😳", pleading_face: "🥺", cry: "😢", sob: "😭", scream: "😱",
  confounded: "😖", disappointed: "😞", sweat: "😓", weary: "😩", tired_face: "😫", yawning_face: "🥱",
  triumph: "😤", rage: "😡", angry: "😠", exploding_head: "🤯", face_palm: "🤦", facepalm: "🤦", shrug: "🤷",
  skull: "💀", poop: "💩", clown_face: "🤡", ghost: "👻", alien: "👽", robot: "🤖", robot_face: "🤖",
  see_no_evil: "🙈", hear_no_evil: "🙉", speak_no_evil: "🙊", eyes: "👀", eye: "👁️", brain: "🧠",
  "+1": "👍", thumbsup: "👍", "-1": "👎", thumbsdown: "👎", ok_hand: "👌", wave: "👋", clap: "👏", raised_hands: "🙌",
  pray: "🙏", muscle: "💪", point_up: "☝️", point_right: "👉", point_left: "👈", point_down: "👇", v: "✌️",
  crossed_fingers: "🤞", handshake: "🤝", writing_hand: "✍️", call_me_hand: "🤙", metal: "🤘", fist: "✊",
  heart: "❤️", orange_heart: "🧡", yellow_heart: "💛", green_heart: "💚", blue_heart: "💙", purple_heart: "💜",
  black_heart: "🖤", broken_heart: "💔", sparkling_heart: "💖", "100": "💯", fire: "🔥", sparkles: "✨", star: "⭐",
  star2: "🌟", zap: "⚡", boom: "💥", collision: "💥", tada: "🎉", confetti_ball: "🎊", party_popper: "🎉", gift: "🎁",
  trophy: "🏆", medal: "🏅", rocket: "🚀", airplane: "✈️", car: "🚗", bulb: "💡", warning: "⚠️", no_entry: "⛔",
  x: "❌", white_check_mark: "✅", heavy_check_mark: "✔️", check: "✔️", question: "❓", exclamation: "❗",
  bangbang: "‼️", interrobang: "⁉️", hourglass: "⌛", stopwatch: "⏱️", alarm_clock: "⏰", calendar: "📅",
  memo: "📝", pencil: "📝", pencil2: "✏️", book: "📖", books: "📚", bookmark: "🔖", paperclip: "📎", pushpin: "📌",
  lock: "🔒", unlock: "🔓", key: "🔑", hammer: "🔨", wrench: "🔧", gear: "⚙️", hammer_and_wrench: "🛠️",
  mag: "🔍", link: "🔗", package: "📦", inbox_tray: "📥", outbox_tray: "📤", email: "📧", phone: "📱",
  computer: "💻", desktop_computer: "🖥️", keyboard: "⌨️", floppy_disk: "💾", cd: "💿", chart_with_upwards_trend: "📈",
  chart_with_downwards_trend: "📉", bar_chart: "📊", clipboard: "📋", file_folder: "📁", open_file_folder: "📂",
  bug: "🐛", beetle: "🪲", ant: "🐜", snake: "🐍", turtle: "🐢", crab: "🦀", octopus: "🐙", whale: "🐳",
  dog: "🐶", cat: "🐱", fox_face: "🦊", bear: "🐻", panda_face: "🐼", unicorn: "🦄", sheep: "🐑", ram: "🐏",
  coffee: "☕", tea: "🍵", beer: "🍺", beers: "🍻", wine_glass: "🍷", pizza: "🍕", hamburger: "🍔", cake: "🍰",
  sun: "☀️", sunny: "☀️", cloud: "☁️", rainbow: "🌈", snowflake: "❄️", umbrella: "☔", ocean: "🌊", earth_americas: "🌎",
  seedling: "🌱", herb: "🌿", four_leaf_clover: "🍀", rose: "🌹", sunflower: "🌻", cactus: "🌵", evergreen_tree: "🌲",
  moneybag: "💰", dollar: "💵", gem: "💎", crystal_ball: "🔮", dart: "🎯", game_die: "🎲", video_game: "🎮",
  joystick: "🕹️", art: "🎨", musical_note: "🎵", headphones: "🎧", microphone: "🎤", camera: "📷", movie_camera: "🎥",
  arrow_right: "➡️", arrow_left: "⬅️", arrow_up: "⬆️", arrow_down: "⬇️", repeat: "🔁", recycle: "♻️",
  red_circle: "🔴", green_circle: "🟢", yellow_circle: "🟡", large_blue_circle: "🔵", white_circle: "⚪",
  black_circle: "⚫", construction: "🚧", rotating_light: "🚨", sos: "🆘", new: "🆕", free: "🆓", up: "🆙",
  cool: "🆒", ok: "🆗", zzz: "💤", speech_balloon: "💬", thought_balloon: "💭", wave_hand: "👋", salute: "🫡",
  melting_face: "🫠", saluting_face: "🫡", heart_hands: "🫶", smiling_face_with_tear: "🥲", partying_face: "🥳",
  cowboy_hat_face: "🤠", disguised_face: "🥸", cold_face: "🥶", hot_face: "🥵", woozy_face: "🥴", monocle_face: "🧐",
  money_mouth_face: "🤑", lying_face: "🤥", nauseated_face: "🤢", vomiting_face: "🤮", sneezing_face: "🤧",
};

export const PICKER = [
  "👍", "👎", "🙏", "👏", "🙌", "👀", "🤔", "😄", "😂", "🤣", "😅", "😉", "😊", "🙂", "😍", "🥳",
  "😎", "🤓", "🤯", "😬", "😐", "🙄", "😢", "😭", "😱", "😡", "🤦", "🤷", "❤️", "🔥", "✨", "🎉",
  "🚀", "💡", "✅", "❌", "⚠️", "❓", "💯", "⭐", "🐛", "🔧", "🛠️", "📌", "📝", "🔍", "💬", "☕",
];

const CODE = /:([a-z0-9_+-]+):/g;

// Replaces the known shortcodes in `text`; unknown ones stay as typed.
export const emojify = (text) => text.replace(CODE, (m, code) => SHORTCODES[code] ?? m);

// The : menu: emoji whose name matches what's typed after the colon, as
// Slack orders them: a name that is it, then names that start with it, then
// names with a word that does, then any that contain it. Slack's names come
// before Unicode's, each emoji once, the ones used most first in each group.
let ALL = null;
export async function emojiMatches(query, usage = {}, limit = 60) {
  if (!ALL) {
    ALL = [...Object.entries(SHORTCODES).map(([n, c]) => [n, c, 0]), ...Object.entries(UNICODE_NAMES).map(([n, c]) => [n, c, 1])];
  }
  const q = query.toLowerCase();
  const tier = (n) => n === q ? 0 : n.startsWith(q) ? 1 : n.split(/[_-]/).some((w) => w.startsWith(q)) ? 2 : n.includes(q) ? 3 : 9;
  const seen = new Set();
  return ALL.map(([name, char, src]) => ({ name, char, src, t: tier(name) })).filter((x) => x.t < 9)
    .sort((a, b) => a.t - b.t || (usage[b.char] ?? 0) - (usage[a.char] ?? 0) || a.src - b.src || a.name.length - b.name.length)
    .filter((x) => { const k = x.char.replace(/️/g, ""); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, limit);
}
