import { Catalog } from "@/components/tools/catalog";
import { Hero } from "@/components/tools/hero";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-8 px-4 py-8 sm:px-6">
      <Hero />
      <Catalog />
    </main>
  );
}
