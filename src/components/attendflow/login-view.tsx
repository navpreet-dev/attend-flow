"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { GraduationCap, Loader2, Lock, ShieldCheck, RefreshCw, BellRing, FileDown } from "lucide-react";

interface LoginViewProps {
  onLogin: (rollNo: string, password: string, remember: boolean) => Promise<void>;
}

export function LoginView({ onLogin }: LoginViewProps) {
  const [rollNo, setRollNo] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    if (!rollNo.trim() || !password) {
      setError("Please enter both your roll number and password.");
      return;
    }
    setLoading(true);
    try {
      await onLogin(rollNo.trim(), password, remember);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="w-full max-w-5xl grid lg:grid-cols-2 gap-8 items-center"
      >
        {/* Left: brand + pitch */}
        <div className="order-2 lg:order-1 space-y-6 text-center lg:text-left">
          <div className="inline-flex items-center gap-2">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-lg shadow-emerald-600/20">
              <GraduationCap className="h-6 w-6" aria-hidden="true" />
            </div>
            <span className="text-2xl font-bold tracking-tight">AttendFlow</span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-balance">
            Your AGC attendance,{" "}
            <span className="text-emerald-600 dark:text-emerald-500">tracked automatically.</span>
          </h1>
          <p className="text-muted-foreground text-base sm:text-lg max-w-xl mx-auto lg:mx-0">
            Sign in with your AGC ERP student credentials — AttendFlow fetches your live
            subject-wise attendance straight from the college portal. No manual entry,
            ever. Works for every department, every course, every section.
          </p>

          <div className="grid sm:grid-cols-2 gap-3 text-left">
            {[
              { icon: RefreshCw, title: "Auto-sync", desc: "Live data pulled from agclms.in every day" },
              { icon: ShieldCheck, title: "Encrypted", desc: "Credentials sealed with AES-256-GCM" },
              { icon: BellRing, title: "Smart alerts", desc: "Low-attendance warnings & notifications" },
              { icon: FileDown, title: "One-click export", desc: "CSV / JSON reports anytime" },
            ].map((f) => (
              <div key={f.title} className="flex items-start gap-3 rounded-lg border bg-card p-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-600/10 text-emerald-600 dark:text-emerald-500">
                  <f.icon className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold leading-tight">{f.title}</p>
                  <p className="text-xs text-muted-foreground leading-snug">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-center lg:justify-start gap-2">
            <Badge variant="secondary" className="font-medium">All departments</Badge>
            <Badge variant="secondary" className="font-medium">All courses</Badge>
            <Badge variant="secondary" className="font-medium">All sections</Badge>
          </div>
        </div>

        {/* Right: login card */}
        <Card className="order-1 lg:order-2 w-full max-w-md mx-auto shadow-xl border-2">
          <CardHeader className="space-y-1 pb-2">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-lg shadow-emerald-600/25">
              <Lock className="h-7 w-7" aria-hidden="true" />
            </div>
            <CardTitle className="text-center text-xl pt-2">Student Login</CardTitle>
            <CardDescription className="text-center">
              Use the same roll number &amp; password as the college portal
            </CardDescription>
          </CardHeader>
          <CardContent className="pb-6">
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="rollNo">Univ. Roll No / Student ID</Label>
                <Input
                  id="rollNo"
                  name="rollNo"
                  autoComplete="username"
                  placeholder="e.g. 24BCA1234"
                  value={rollNo}
                  onChange={(e) => setRollNo(e.target.value)}
                  disabled={loading}
                  className="h-11"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Portal Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Your AGC ERP password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  className="h-11"
                  required
                />
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="remember"
                  checked={remember}
                  onCheckedChange={(v) => setRemember(v === true)}
                  disabled={loading}
                />
                <Label htmlFor="remember" className="text-sm font-normal text-muted-foreground cursor-pointer">
                  Remember me &amp; auto-sync daily (credentials stay encrypted)
                </Label>
              </div>

              {error && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {error}
                </motion.p>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-11 text-base font-semibold bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    Connecting to AGC ERP…
                  </>
                ) : (
                  "Fetch My Attendance"
                )}
              </Button>
            </form>

            <Separator className="my-5" />
            <p className="text-xs text-muted-foreground text-center leading-relaxed">
              AttendFlow logs in to{" "}
              <span className="font-mono">agclms.in</span> on your behalf and reads only
              your own attendance data. Your password is never shared with anyone and is
              stored encrypted only if you tick &quot;Remember me&quot;.
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
