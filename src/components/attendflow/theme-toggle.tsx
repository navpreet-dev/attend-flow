"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  return (
    <Button
      variant="outline"
      size="icon"
      aria-label="Toggle dark mode"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="rounded-full"
    >
      {mounted && resolvedTheme === "dark" ? (
        <Sun className="h-[1.2rem] w-[1.2rem]" aria-hidden="true" />
      ) : (
        <Moon className="h-[1.2rem] w-[1.2rem]" aria-hidden="true" />
      )}
    </Button>
  );
}
