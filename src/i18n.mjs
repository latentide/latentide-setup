// 界面只有中英两种语言：系统语言以 zh 开头用中文，其余用英文；--lang 可覆盖。
let lang = detectLang();

function detectLang(env = process.env) {
  const raw = env.LATENTIDE_LANG || env.LC_ALL || env.LC_MESSAGES || env.LANG || Intl.DateTimeFormat().resolvedOptions().locale || '';
  return /^zh/i.test(raw) ? 'zh' : 'en';
}

export function setLang(value) {
  if (value === 'zh' || value === 'en') lang = value;
}

export function getLang() {
  return lang;
}

/** 两种语言写在同一处调用里，避免两份字典走样。 */
export function msg(zh, en) {
  return lang === 'zh' ? zh : en;
}
