import Image from "next/image";
import Link from "next/link";
import styles from "./page.module.css";
import ClientBits from "./client-bits";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-8 py-16">
      <h1 data-testid="heading" className={styles.heading}>
        Landing draft
      </h1>
      <p className="font-mono text-sm text-zinc-500 dark:text-zinc-400">
        Tailwind + CSS Module + next/font + next/image + styled-jsx.{" "}
        <Link href="/about" className="underline">
          About
        </Link>
      </p>
      <Image src="/gradient.png" alt="gradient" width={320} height={160} priority />
      <ClientBits />
      <div data-testid="scroller" className={styles.scroller}>
        {Array.from({ length: 30 }, (_, i) => (
          <p key={i}>Row {i + 1}</p>
        ))}
      </div>
      {Array.from({ length: 12 }, (_, i) => (
        <section key={i} className="rounded-lg bg-zinc-100 p-8 dark:bg-zinc-900">
          Section {i + 1}
        </section>
      ))}
    </main>
  );
}
