"use client";

import { useMemo, useState, useEffect } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  CheckCheck,
  CheckCircle2,
  Sparkles,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import type { DashboardPayload } from "@/lib/types";
import {
  generateSmartNotifications,
  getDismissedIds,
  dismissNotificationId,
  clearDismissedNotifications,
  type SmartNotification,
} from "@/lib/smart-notifications";

interface NotificationsPopoverProps {
  data: DashboardPayload;
  prevData?: DashboardPayload | null;
  onSelectSubjectForSimulator?: (subjectCode: string) => void;
}

export function NotificationsPopover({
  data,
  prevData,
  onSelectSubjectForSimulator,
}: NotificationsPopoverProps) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(() => getDismissedIds());

  const allNotifications = useMemo(
    () => generateSmartNotifications(data, prevData),
    [data, prevData]
  );

  const activeNotifications = useMemo(
    () => allNotifications.filter((n) => !dismissed.has(n.id)),
    [allNotifications, dismissed]
  );

  const unreadCount = activeNotifications.length;
  const hasCritical = activeNotifications.some((n) => n.severity === "high");

  function handleDismiss(id: string) {
    dismissNotificationId(id);
    setDismissed(new Set(getDismissedIds()));
  }

  function handleClearAll() {
    for (const n of activeNotifications) {
      dismissNotificationId(n.id);
    }
    setDismissed(new Set(getDismissedIds()));
  }

  function handleReset() {
    clearDismissedNotifications();
    setDismissed(new Set());
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="relative h-9 w-9 p-0 rounded-xl"
          aria-label={`Attendance notifications (${unreadCount} unread)`}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span
              className={`absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white shadow-sm ${
                hasCritical ? "bg-rose-500 animate-pulse" : "bg-emerald-600"
              }`}
            >
              {unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 sm:w-96 p-0 rounded-2xl shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/70">
          <div className="flex items-center gap-2">
            <span className="font-display text-sm font-semibold">Notifications</span>
            {unreadCount > 0 && (
              <Badge variant="secondary" className="text-[11px] font-mono px-1.5 py-0 h-4">
                {unreadCount}
              </Badge>
            )}
          </div>
          {unreadCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1 px-2"
              onClick={handleClearAll}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px] text-muted-foreground hover:text-foreground px-2"
              onClick={handleReset}
            >
              Reset alerts
            </Button>
          )}
        </div>

        <ScrollArea className="max-h-[380px] [&>[data-slot=scroll-area-viewport]]:max-h-[380px]">
          {activeNotifications.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted-foreground flex flex-col items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600/10 text-emerald-600">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <p className="font-medium text-foreground">You&apos;re all caught up!</p>
              <p className="text-muted-foreground max-w-[200px]">
                No low-attendance alerts or urgent warnings right now.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {activeNotifications.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  onDismiss={() => handleDismiss(n.id)}
                  onAction={() => {
                    setOpen(false);
                    if (n.actionSubjectCode && onSelectSubjectForSimulator) {
                      onSelectSubjectForSimulator(n.actionSubjectCode);
                    }
                  }}
                />
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

function NotificationItem({
  notification,
  onDismiss,
  onAction,
}: {
  notification: SmartNotification;
  onDismiss: () => void;
  onAction: () => void;
}) {
  const isHigh = notification.severity === "high";
  const isMedium = notification.severity === "medium";

  return (
    <div
      className={`relative p-3.5 transition-colors ${
        isHigh
          ? "bg-rose-500/[0.04] hover:bg-rose-500/[0.08]"
          : isMedium
          ? "bg-amber-500/[0.04] hover:bg-amber-500/[0.08]"
          : "hover:bg-muted/40"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <div
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
            isHigh
              ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
              : isMedium
              ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
              : "bg-emerald-600/15 text-emerald-600 dark:text-emerald-400"
          }`}
        >
          {notification.type === "CRITICAL_LOW" ? (
            <AlertCircle className="h-4 w-4" />
          ) : notification.type === "NEAR_THRESHOLD" ? (
            <AlertTriangle className="h-4 w-4" />
          ) : notification.type === "RECOVERY_MILESTONE" ? (
            <Sparkles className="h-4 w-4" />
          ) : notification.type === "SIGNIFICANT_DROP" ? (
            <TrendingDown className="h-4 w-4" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
        </div>

        <div className="min-w-0 flex-1 pr-6">
          <p className="font-display text-xs font-semibold leading-tight text-foreground">
            {notification.title}
          </p>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            {notification.message}
          </p>
          {notification.actionSubjectCode && (
            <button
              type="button"
              onClick={onAction}
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 hover:underline"
            >
              <TrendingUp className="h-3 w-3" />
              Simulate recovery plan →
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onDismiss}
          className="absolute top-3 right-3 text-muted-foreground/60 hover:text-foreground rounded-full p-1 transition-colors"
          aria-label="Dismiss alert"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
