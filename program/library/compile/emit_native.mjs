import { handleNativeExists } from "./emit_native/exists.mjs";
import { handleNativeBoolean } from "./emit_native/boolean.mjs";
import { handleNativeInterpret } from "./emit_native/interpret.mjs";
import { handleNativeList } from "./emit_native/list.mjs";
import { handleNativeEcology } from "./emit_native/ecology.mjs";
import { handleNativeLicense } from "./emit_native/license.mjs";
import { handleNativeCopy } from "./emit_native/copy.mjs";
import { handleNativeDirectory } from "./emit_native/directory.mjs";
import { handleNativeDelete } from "./emit_native/delete.mjs";
import { handleNativePathJoin } from "./emit_native/path_join.mjs";
import { handleNativeTouch } from "./emit_native/touch.mjs";
import { handleNativeRename } from "./emit_native/rename.mjs";

export function handleNativeSentence(context, helpers) {
  const existsResult = handleNativeExists(context, helpers);
  if (existsResult) return existsResult;

  const boolResult = handleNativeBoolean(context, helpers);
  if (boolResult) return boolResult;

  const interpretResult = handleNativeInterpret(context, helpers);
  if (interpretResult) return interpretResult;

  const listResult = handleNativeList(context, helpers);
  if (listResult) return listResult;

  const ecologyResult = handleNativeEcology(context, helpers);
  if (ecologyResult) return ecologyResult;

  const licenseResult = handleNativeLicense(context, helpers);
  if (licenseResult) return licenseResult;

  const copyResult = handleNativeCopy(context, helpers);
  if (copyResult) return copyResult;

  const touchResult = handleNativeTouch(context, helpers);
  if (touchResult) return touchResult;

  const renameResult = handleNativeRename(context, helpers);
  if (renameResult) return renameResult;

  const directoryResult = handleNativeDirectory(context, helpers);
  if (directoryResult) return directoryResult;

  const deleteResult = handleNativeDelete(context, helpers);
  if (deleteResult) return deleteResult;

  const pathJoinResult = handleNativePathJoin(context, helpers);
  if (pathJoinResult) return pathJoinResult;

  return null;
}
