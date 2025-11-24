export default async function addNumToNull({ obj }) {
  return { obj: (obj?.num ?? obj) };
}
