import { remember } from "../remember/index.mjs";

export default function add_obj_num_to_name({ obj, to }) {
  const target = remember(to.name);
  if (!target) throw new Error(`add: unknown variable ${to.name}`);

  const a = Number(obj?.num ?? obj);
  const b = Number(target.obj?.num ?? target.obj ?? 0);
  const result = a + b;
  target.obj = { num: result };
  return { obj: result };
}
