export function add({ obj, to }) {
  if (typeof obj === "number" && typeof to === "number")
    return { obj: obj + to };
  if (typeof obj === "string" && typeof to === "string")
    return { obj: obj + to };
  throw new Error("add: unsupported types");
}
