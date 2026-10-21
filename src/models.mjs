// 编程客户端几乎都靠工具调用干活，所以默认只列出“该协议下支持工具调用”的模型，
// 免得用户配完第一句话就报错。能力以网关 /models 实时返回为准，这里不另存模型清单。

export function supports(model, protocol, { tools = true } = {}) {
  const cell = model.perProtocol?.[protocol];
  if (!cell) return false;
  return tools ? cell.tools === true : true;
}

export function supportsImages(model, protocol) {
  return (model.perProtocol?.[protocol]?.input_modalities ?? []).includes('image');
}

export function modelsFor(models, protocol, options) {
  return models.filter((model) => supports(model, protocol, options));
}

/** 按偏好顺序选第一个可用的；偏好都不在时退回该协议下的第一个模型。 */
export function pickDefault(models, protocol, preferences = []) {
  const usable = modelsFor(models, protocol);
  for (const id of preferences) {
    const hit = usable.find((model) => model.id === id);
    if (hit) return hit;
  }
  return usable[0] ?? null;
}

export function findModel(models, id) {
  const wanted = String(id).toLowerCase();
  return models.find((model) => model.id.toLowerCase() === wanted) ?? null;
}
