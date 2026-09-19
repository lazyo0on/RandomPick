import { MapEditor } from './editor';

// editor.html is just a shell; the editor builds its own DOM.
const root = document.getElementById('editorRoot');
if (root) {
  const editor = new MapEditor(root);
  // Handy for debugging from the browser console.
  // eslint-disable-next-line
  (window as any).__editor = editor;
}
