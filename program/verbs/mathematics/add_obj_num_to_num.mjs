export default function add_obj_num_to_num({ obj, to }) {
  const a = Number(obj?.num ?? obj);
  const b = Number(to?.num ?? to);
  return { obj: a + b };
}
