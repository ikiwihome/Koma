// Vite ?raw import 的类型声明
// 让 TypeScript 接受 `import x from './foo.md?raw'` 这类导入
declare module '*.md?raw' {
  const content: string;
  export default content;
}
