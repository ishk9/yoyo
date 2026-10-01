import Link from "next/link";

export default function About() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-8 py-16">
      <h1 className="text-3xl font-bold">About</h1>
      <Link href="/" className="underline">
        Home
      </Link>
    </main>
  );
}
