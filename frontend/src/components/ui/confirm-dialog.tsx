import { useState, useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, X } from "lucide-react";

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export function useConfirm() {
  const [state, setState] = useState<{
    open: boolean;
    resolve: (v: boolean) => void;
    options: ConfirmOptions;
  } | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions): Promise<boolean> => {
      return new Promise((resolve) => {
        setState({ open: true, resolve, options });
      });
    },
    [],
  );

  function handleAnswer(answer: boolean) {
    state?.resolve(answer);
    setState(null);
  }

  const dialog = state ? (
    <Dialog.Root open={state.open} onOpenChange={(open) => { if (!open) handleAnswer(false); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-popover p-6 shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out">
          <div className="flex items-start gap-4">
            <div className={state.options.destructive ? "rounded-full bg-destructive/10 p-2" : "rounded-full bg-amber-500/10 p-2"}>
              <AlertTriangle size={20} className={state.options.destructive ? "text-destructive" : "text-amber-500"} />
            </div>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-base font-semibold">{state.options.title}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                {state.options.message}
              </Dialog.Description>
            </div>
            <Dialog.Close className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors">
              <X size={14} />
            </Dialog.Close>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <button
              onClick={() => handleAnswer(false)}
              className="px-3 py-1.5 text-sm rounded-md border hover:bg-accent transition-colors"
            >
              {state.options.cancelLabel ?? "Cancel"}
            </button>
            <button
              onClick={() => handleAnswer(true)}
              className={
                "px-3 py-1.5 text-sm rounded-md font-medium transition-colors " +
                (state.options.destructive
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : "bg-primary text-primary-foreground hover:bg-primary/90")
              }
            >
              {state.options.confirmLabel ?? "Confirm"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  ) : null;

  return { confirm, dialog };
}