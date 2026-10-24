import readline from 'node:readline';

// 只用 Node 自带的 readline，不引第三方交互库：npx 首次运行下载越少越好，也少一份供应链风险。

export function isInteractive(input = process.stdin, output = process.stdout) {
  return Boolean(input.isTTY && output.isTTY);
}

export async function ask(question, { input = process.stdin, output = process.stdout } = {}) {
  const rl = readline.createInterface({ input, output, terminal: true });
  try {
    return await new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
  } finally {
    rl.close();
  }
}

/** 隐藏输入（输入 Key 时屏幕上只显示 *）。 */
export async function askSecret(question, { input = process.stdin, output = process.stdout } = {}) {
  output.write(question);
  if (!input.isTTY) return (await readAll(input)).trim();
  return await new Promise((resolve, reject) => {
    let value = '';
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    const done = (result, error) => {
      input.setRawMode(false);
      input.pause();
      input.removeListener('data', onData);
      output.write('\n');
      if (error) reject(error); else resolve(result.trim());
    };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') return done(value);
        if (char === '\u0003') return done('', new Error('Cancelled'));
        if (char === '\u007f' || char === '\b') {
          if (value) { value = value.slice(0, -1); output.write('\b \b'); }
          continue;
        }
        if (char < ' ') continue;
        value += char;
        output.write('*');
      }
    };
    input.on('data', onData);
  });
}

export async function readAll(input = process.stdin) {
  let data = '';
  input.setEncoding('utf8');
  for await (const chunk of input) data += chunk;
  return data;
}

export async function confirm(question, { defaultYes = true, ...io } = {}) {
  const answer = (await ask(`${question} ${defaultYes ? '[Y/n]' : '[y/N]'} `, io)).toLowerCase();
  if (!answer) return defaultYes;
  return ['y', 'yes', '是', '好'].includes(answer);
}
