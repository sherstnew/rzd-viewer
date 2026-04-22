"use client";

import dynamic from "next/dynamic";
import { SearchBox } from "@/components/search";

const MapExample = dynamic(
    () => import("@/components/map-example").then((mod) => mod.MapExample),
    {
        ssr: false,
        loading: () => (
            <div className="flex h-full w-full items-center justify-center bg-muted text-sm text-muted-foreground">
                Загружаем карту...
            </div>
        ),
    }
);

export default function Page() {
    return (
        <main className="flex w-full flex-1 flex-col gap-6 relative">
            <SearchBox />
            <MapExample />
        </main>
    );
}
