export function rememberHelperSource() {
  return `const remember = (typeof globalThis.remember === \"function\" ? globalThis.remember : (ref) => {\n  if (ref && typeof ref === \"object\") {\n    const name = ref.name || ref.su?.name;\n    if (typeof name === \"string\") {\n      if (globalThis && Object.prototype.hasOwnProperty.call(globalThis, name)) return globalThis[name];\n    }\n    return ref;\n  }\n  if (typeof ref === \"string\") {\n    if (globalThis && Object.prototype.hasOwnProperty.call(globalThis, ref)) return globalThis[ref];\n    return undefined;\n  }\n  return ref;\n});`;
}
