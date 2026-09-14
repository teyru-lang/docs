import Link from 'next/link';
import { appName, compilerRepo } from '@/lib/shared';

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-6 py-24 text-center">
      <h1 className="text-4xl font-bold tracking-tight">{appName}</h1>
      <p className="text-lg text-fd-muted-foreground">
        Teyru 是一門獨立實作的程式語言：編譯器完全用 Go 撰寫，直接產生原生執行檔——不依賴
        JVM、不依賴 javac、不產生任何 bytecode。
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link
          href="/docs"
          className="rounded-lg bg-fd-primary px-4 py-2 font-medium text-fd-primary-foreground"
        >
          閱讀文件
        </Link>
        <Link href="/docs/language" className="rounded-lg border border-fd-border px-4 py-2 font-medium">
          語言參考
        </Link>
        <a
          href={compilerRepo}
          className="rounded-lg border border-fd-border px-4 py-2 font-medium"
          rel="noreferrer"
        >
          編譯器原始碼
        </a>
      </div>
    </main>
  );
}
