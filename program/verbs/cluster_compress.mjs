import { clusterCompress } from "../library/zim_archive.mjs";

export { clusterCompress };
export default clusterCompress;

export const signatures = [
  { signatureWords: ["be", "cluster-compress", "become", "wo", "zim", "from", "text", "fromstate", "wo", "text", "to", "filename"], handler: clusterCompress },
  { signatureWords: ["be", "cluster-compress", "become", "wo", "zim", "from", "filename", "fromstate", "wo", "text", "to", "filename"], handler: clusterCompress },
  { signatureWords: ["be", "cluster-compress", "become", "wo", "zim", "from", "filename", "fromstate", "wo", "html", "to", "filename"], handler: clusterCompress },
  { signatureWords: ["be", "cluster-compress", "become", "wo", "zim", "from", "filename", "fromstate", "wo", "warc", "to", "filename"], handler: clusterCompress },
  { signatureWords: ["be", "cluster-compress", "become", "wo", "zim", "from", "filename", "fromstate", "wo", "web", "to", "filename"], handler: clusterCompress }
];
