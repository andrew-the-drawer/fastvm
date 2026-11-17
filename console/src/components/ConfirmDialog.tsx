import { Dialog } from "@base-ui/react/dialog";
import { Button } from "antd";
import type { ReactNode } from "react";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button with destructive styling. */
  danger?: boolean;
  /** Shows a spinner on the confirm button and blocks both buttons. */
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Base UI confirmation dialog used for destructive actions. It is intentionally
 * separate from antd's Modal so it can be opened from both the table and the
 * detail drawer without stacking antd modal contexts.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onCancel();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="bu-backdrop" />
        <Dialog.Viewport className="bu-dialog-viewport">
          <Dialog.Popup className="bu-dialog-popup">
            <Dialog.Title className="bu-dialog-title">{title}</Dialog.Title>
            <Dialog.Description className="bu-dialog-description">{description}</Dialog.Description>
            <div className="bu-dialog-actions">
              <Button onClick={onCancel} disabled={loading}>
                {cancelLabel}
              </Button>
              <Button
                type="primary"
                danger={danger}
                loading={loading}
                onClick={onConfirm}
                className={
                  danger ? "bu-dialog-confirm bu-dialog-confirm--danger" : "bu-dialog-confirm"
                }
              >
                {confirmLabel}
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default ConfirmDialog;
