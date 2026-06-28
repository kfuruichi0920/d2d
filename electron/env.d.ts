/// <reference types="vite/client" />

// Vite ?raw インポートの型宣言（main プロセス用）
declare module '*.sql?raw' {
  const content: string
  export default content
}
