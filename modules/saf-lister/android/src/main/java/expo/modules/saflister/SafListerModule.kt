package expo.modules.saflister

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private val CHILD_PROJECTION = arrayOf(
  DocumentsContract.Document.COLUMN_DOCUMENT_ID,
  DocumentsContract.Document.COLUMN_MIME_TYPE,
)

/**
 * Lists the direct children of a Storage Access Framework folder with ONE provider query.
 *
 * Why not expo-file-system's `Directory.list()`: it is a synchronous JS-thread call that asks the
 * provider whether each child is a directory, one query per child. On the tablet's anime root that
 * was 558 queries and 5.7 s with the UI frozen (docs/anime-folders.md). Here the children query
 * returns every child's MIME type at once, off the JS thread, on the IO dispatcher so the walk can
 * list a whole level of folders at the same time.
 */
class SafListerModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("SafLister")

    // Rejects when the grant or the SD card is gone, so the caller can mark the root lost.
    AsyncFunction("listChildren") Coroutine { uriString: String ->
      withContext(Dispatchers.IO) { listChildren(uriString) }
    }
  }

  private fun listChildren(uriString: String): List<Map<String, Any>> {
    val uri = Uri.parse(uriString)
    val parentId =
      if (DocumentsContract.isDocumentUri(context, uri)) {
        DocumentsContract.getDocumentId(uri)
      } else {
        DocumentsContract.getTreeDocumentId(uri)
      }
    val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(uri, parentId)
    val cursor =
      context.contentResolver.query(childrenUri, CHILD_PROJECTION, null, null, null)
        ?: throw IllegalStateException("The folder cannot be listed: $uriString")

    return cursor.use {
      val children = ArrayList<Map<String, Any>>(it.count)
      while (it.moveToNext()) {
        val documentId = it.getString(0) ?: continue
        children.add(
          mapOf(
            "uri" to DocumentsContract.buildDocumentUriUsingTree(uri, documentId).toString(),
            "isDirectory" to (it.getString(1) == DocumentsContract.Document.MIME_TYPE_DIR),
          ),
        )
      }
      children
    }
  }
}
