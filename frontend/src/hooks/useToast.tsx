import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";
import * as Toast from "@radix-ui/react-toast";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastVariant = "default" | "success" | "error" | "warning";

interface ToastData {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (title: string, opts?: { description?: string; variant?: ToastVariant }) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const variantStyles: Record<ToastVariant, string> = {
  default: "border-border",
  success: "border-green-500/50",
  error: "border-destructive",
  warning: "border-yellow-500/50",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const counter = useRef(0);

  const toast = useCallback(
    (title: string, opts?: { description?: string; variant?: ToastVariant }) => {
      const id = String(++counter.current);
      setToasts((prev) => [...prev, { id, title, description: opts?.description, variant: opts?.variant ?? "default" }]);
    },
    [],
  );

  function dismiss(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <ToastContext.Provider value={{ toast }}>
      <Toast.Provider swipeDirection="right" duration={5000}>
        {children}
        {toasts.map((t) => (
          <Toast.Root
            key={t.id}
            open
            onOpenChange={(open) => { if (!open) dismiss(t.id); }}
            className={cn(
              "w-80 rounded-lg border bg-popover p-4 shadow-lg data-[swipe=end]:animate-swipe-out data-[state=closed]:animate-hide data-[state=open]:animate-slide-in",
              variantStyles[t.variant],
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <Toast.Title className="text-sm font-semibold">{t.title}</Toast.Title>
                {t.description && (
                  <Toast.Description className="mt-0.5 text-xs text-muted-foreground">
                    {t.description}
                  </Toast.Description>
                )}
              </div>
              <Toast.Close aria-label="Close" className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors">
                <X size={14} />
              </Toast.Close>
            </div>
          </Toast.Root>
        ))}
        <Toast.Viewport className="fixed bottom-4 right-4 z-[100] flex flex-col-reverse gap-2 outline-none" />
      </Toast.Provider>
    </ToastContext.Provider>
  );
}