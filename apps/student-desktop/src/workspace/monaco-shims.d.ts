declare module 'monaco-editor/esm/vs/editor/editor.all.js';
declare module 'monaco-editor/esm/vs/basic-languages/python/python.contribution.js';
declare module 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js';
declare module 'monaco-editor/esm/vs/basic-languages/java/java.contribution.js';
declare module 'monaco-editor/esm/vs/editor/editor.worker?worker' {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}
