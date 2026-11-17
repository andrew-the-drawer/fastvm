import { useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { CreateSandboxInput } from "../lib/api";
import { useCreateSandbox, useImages } from "../lib/queries";
import { Button, Field, Input, Modal, Select, Switch, useToast } from "../ui";
import { describeError } from "../utils/errors";
import { formatBytes, imageLabel } from "../utils/format";
import { HardDriveIcon, InfoIcon, PlusIcon, ServerIcon, TrashIcon } from "./icons";

export interface CreateVmModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (sandbox: { id: string; name: string }) => void;
}

interface VolumeRow {
  id: number;
  host_path: string;
  guest_path: string;
  read_only: boolean;
}

interface VolumeErrors {
  host?: string;
  guest?: string;
}

interface FormErrors {
  image?: string;
  name?: string;
  vcpus?: string;
  memory_mb?: string;
}

const DEFAULT_VCPUS = "2";
const DEFAULT_MEMORY = "512";

function validateVolume(volume: VolumeRow): VolumeErrors {
  const errors: VolumeErrors = {};
  const hostPath = volume.host_path.trim();
  const guestPath = volume.guest_path.trim();
  if (hostPath === "") {
    errors.host = "Host path is required.";
  } else if (!hostPath.startsWith("/")) {
    errors.host = "Host path must be absolute (start with /).";
  }
  if (guestPath === "") {
    errors.guest = "Guest mount is required.";
  } else if (!/^\/[^\s:,]*$/.test(guestPath)) {
    errors.guest = "Absolute path, no spaces, ':' or ','.";
  }
  return errors;
}

/** Create-sandbox dialog: image, optional name, vCPUs, memory, auto-sleep and host volumes. */
export function CreateVmModal({ open, onClose, onCreated }: CreateVmModalProps) {
  const toast = useToast();
  const images = useImages();
  const createSandbox = useCreateSandbox();
  const nextVolumeId = useRef(1);

  const [image, setImage] = useState("");
  const [name, setName] = useState("");
  const [vcpus, setVcpus] = useState(DEFAULT_VCPUS);
  const [memoryMb, setMemoryMb] = useState(DEFAULT_MEMORY);
  const [noAutoSleep, setNoAutoSleep] = useState(false);
  const [volumes, setVolumes] = useState<VolumeRow[]>([]);
  const [errors, setErrors] = useState<FormErrors>({});
  const [volumeErrors, setVolumeErrors] = useState<Record<number, VolumeErrors>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isCreating = createSandbox.isPending;
  const imageList = images.data ?? [];
  const noImages = !images.isPending && images.isError === false && imageList.length === 0;

  const resetForm = () => {
    setImage("");
    setName("");
    setVcpus(DEFAULT_VCPUS);
    setMemoryMb(DEFAULT_MEMORY);
    setNoAutoSleep(false);
    setVolumes([]);
    setErrors({});
    setVolumeErrors({});
    setSubmitError(null);
    nextVolumeId.current = 1;
  };

  const handleClose = () => {
    if (isCreating) {
      return;
    }
    setSubmitError(null);
    onClose();
  };

  const addVolume = () => {
    const id = nextVolumeId.current;
    nextVolumeId.current += 1;
    setVolumes((current) => [...current, { id, host_path: "", guest_path: "", read_only: false }]);
  };

  const removeVolume = (id: number) => {
    setVolumes((current) => current.filter((volume) => volume.id !== id));
    setVolumeErrors((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const updateVolume = (id: number, patch: Partial<Omit<VolumeRow, "id">>) => {
    setVolumes((current) =>
      current.map((volume) => (volume.id === id ? { ...volume, ...patch } : volume)),
    );
    setVolumeErrors((current) => {
      if (current[id] === undefined) {
        return current;
      }
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const validate = (): boolean => {
    const nextErrors: FormErrors = {};
    if (image === "") {
      nextErrors.image = "Choose a base disk image.";
    }
    const trimmedName = name.trim();
    if (trimmedName.length > 63) {
      nextErrors.name = "Keep the name to 63 characters or fewer.";
    } else if (trimmedName !== "" && !/^[A-Za-z0-9._-]+$/.test(trimmedName)) {
      nextErrors.name = "Use letters, numbers, dots, dashes or underscores.";
    }
    const vcpuCount = Number(vcpus);
    if (vcpus.trim() === "" || !Number.isInteger(vcpuCount) || vcpuCount < 1 || vcpuCount > 8) {
      nextErrors.vcpus = "vCPUs must be a whole number between 1 and 8.";
    }
    const memory = Number(memoryMb);
    if (memoryMb.trim() === "" || !Number.isInteger(memory) || memory < 64 || memory > 4096) {
      nextErrors.memory_mb = "Memory must be a whole number between 64 and 4096 MB.";
    }

    const nextVolumeErrors: Record<number, VolumeErrors> = {};
    for (const volume of volumes) {
      const volumeError = validateVolume(volume);
      if (volumeError.host !== undefined || volumeError.guest !== undefined) {
        nextVolumeErrors[volume.id] = volumeError;
      }
    }

    setErrors(nextErrors);
    setVolumeErrors(nextVolumeErrors);
    return Object.keys(nextErrors).length === 0 && Object.keys(nextVolumeErrors).length === 0;
  };

  const handleSubmit = async () => {
    setSubmitError(null);
    if (!validate()) {
      return;
    }
    const trimmedName = name.trim();
    const input: CreateSandboxInput = {
      image,
      vcpus: Number(vcpus),
      memory_mb: Number(memoryMb),
      no_auto_sleep: noAutoSleep,
    };
    if (trimmedName !== "") {
      input.name = trimmedName;
    }
    if (volumes.length > 0) {
      input.volumes = volumes.map((volume) => ({
        host_path: volume.host_path.trim(),
        guest_path: volume.guest_path.trim(),
        read_only: volume.read_only,
      }));
    }
    try {
      const created = await createSandbox.mutateAsync(input);
      toast.success(`Sandbox ${created.name} is being created`);
      resetForm();
      onCreated?.({ id: created.id, name: created.name });
      onClose();
    } catch (error) {
      const description = describeError(error);
      setSubmitError(description);
      toast.error(description);
    }
  };

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleSubmit();
  };

  let imageHint: ReactNode;
  if (images.isError) {
    imageHint = (
      <span className="text-red-600 dark:text-red-400">
        Could not load base images: {describeError(images.error)}
      </span>
    );
  } else if (noImages) {
    imageHint = (
      <span className="text-amber-600 dark:text-amber-400">
        No base disk images available. Build an image first (for example `make image` in the
        repository root), then reopen this dialog.
      </span>
    );
  } else if (images.isPending) {
    imageHint = <span>Loading images…</span>;
  } else {
    imageHint = (
      <span className="form-hint">
        <HardDriveIcon className="size-3.5" /> Base disks are read-only; each VM gets a
        copy-on-write volume.
      </span>
    );
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
            <ServerIcon className="size-4" />
          </span>
          Create virtual machine
        </span>
      }
      footer={
        <>
          <Button onClick={handleClose} disabled={isCreating}>
            Cancel
          </Button>
          <Button variant="primary" loading={isCreating} onClick={() => void handleSubmit()}>
            Create VM
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={handleFormSubmit} noValidate>
        <Field
          label="Base image"
          htmlFor="create-image"
          required
          error={errors.image}
          hint={imageHint}
        >
          <Select
            id="create-image"
            value={image}
            disabled={images.isPending || noImages || isCreating}
            onChange={(event) => {
              setImage(event.target.value);
              setErrors((current) => ({ ...current, image: undefined }));
            }}
          >
            <option value="">{images.isPending ? "Loading images…" : "Select an image"}</option>
            {imageList.map((availableImage) => (
              <option key={availableImage.digest} value={availableImage.digest}>
                {imageLabel(availableImage)} · {formatBytes(availableImage.size_bytes)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Name (optional)" htmlFor="create-name" error={errors.name}>
          <Input
            id="create-name"
            placeholder="auto: sb-…"
            autoComplete="off"
            value={name}
            disabled={isCreating}
            onChange={(event) => {
              setName(event.target.value);
              setErrors((current) => ({ ...current, name: undefined }));
            }}
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="vCPUs" htmlFor="create-vcpus" required error={errors.vcpus}>
            <Input
              id="create-vcpus"
              type="number"
              min={1}
              max={8}
              step={1}
              value={vcpus}
              disabled={isCreating}
              onChange={(event) => {
                setVcpus(event.target.value);
                setErrors((current) => ({ ...current, vcpus: undefined }));
              }}
            />
          </Field>
          <Field label="Memory (MB)" htmlFor="create-memory" required error={errors.memory_mb}>
            <Input
              id="create-memory"
              type="number"
              min={64}
              max={4096}
              step={64}
              value={memoryMb}
              disabled={isCreating}
              onChange={(event) => {
                setMemoryMb(event.target.value);
                setErrors((current) => ({ ...current, memory_mb: undefined }));
              }}
            />
          </Field>
        </div>

        <div>
          <div className="flex items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-white">
            <HardDriveIcon className="size-4 text-gray-500 dark:text-gray-400" /> Host volumes
            (virtio-fs)
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Mount host directories into the guest. fastvmd enforces the configured
            <code> volumes.allowed_host_prefixes</code> allowlist.
          </p>

          {volumes.length > 0 ? (
            <div className="mt-2 flex flex-col gap-2">
              {volumes.map((volume) => {
                const rowErrors = volumeErrors[volume.id];
                return (
                  <div
                    key={volume.id}
                    className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800/50"
                  >
                    <Field
                      label="Host path"
                      htmlFor={`volume-host-${volume.id}`}
                      error={rowErrors?.host}
                      className="min-w-[170px] flex-1"
                    >
                      <Input
                        id={`volume-host-${volume.id}`}
                        placeholder="/host/dir"
                        autoComplete="off"
                        value={volume.host_path}
                        disabled={isCreating}
                        onChange={(event) => {
                          updateVolume(volume.id, { host_path: event.target.value });
                        }}
                      />
                    </Field>
                    <Field
                      label="Guest mount"
                      htmlFor={`volume-guest-${volume.id}`}
                      error={rowErrors?.guest}
                      className="min-w-[150px] flex-1"
                    >
                      <Input
                        id={`volume-guest-${volume.id}`}
                        placeholder="/mnt/data"
                        autoComplete="off"
                        value={volume.guest_path}
                        disabled={isCreating}
                        onChange={(event) => {
                          updateVolume(volume.id, { guest_path: event.target.value });
                        }}
                      />
                    </Field>
                    <Field label="Read-only" htmlFor={`volume-ro-${volume.id}`} className="w-24">
                      <div className="flex h-9 items-center">
                        <Switch
                          id={`volume-ro-${volume.id}`}
                          checked={volume.read_only}
                          disabled={isCreating}
                          onChange={(checked) => {
                            updateVolume(volume.id, { read_only: checked });
                          }}
                        />
                      </div>
                    </Field>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Remove volume"
                      disabled={isCreating}
                      className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                      onClick={() => removeVolume(volume.id)}
                      icon={<TrashIcon className="size-4" />}
                    />
                  </div>
                );
              })}
            </div>
          ) : null}

          <Button
            variant="secondary"
            className="mt-2 w-full border-dashed border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-600 hover:border-indigo-400 hover:bg-transparent hover:text-indigo-600 dark:border-gray-700 dark:bg-transparent dark:text-gray-300 dark:hover:border-indigo-500 dark:hover:text-indigo-400"
            icon={<PlusIcon className="size-4" />}
            disabled={isCreating}
            onClick={addVolume}
          >
            Add volume
          </Button>
        </div>

        <Field
          label={
            <span className="inline-flex items-center gap-1.5">
              Disable automatic sleep
              <span
                title="When enabled, fastvmd keeps this sandbox awake even when it is idle. It uses host resources continuously."
                className="inline-flex"
              >
                <InfoIcon className="size-3.5 text-gray-400 dark:text-gray-500" />
              </span>
            </span>
          }
          htmlFor="create-no-auto-sleep"
        >
          <div className="flex h-9 items-center">
            <Switch
              id="create-no-auto-sleep"
              checked={noAutoSleep}
              disabled={isCreating}
              onChange={setNoAutoSleep}
            />
          </div>
        </Field>

        {submitError !== null ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          >
            {submitError}
          </div>
        ) : null}

        <div className="flex items-center gap-2 border-t border-gray-100 pt-4 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
          <PlusIcon className="size-4 text-indigo-600 dark:text-indigo-400" /> The sandbox boots
          from a copy-on-write volume and appears in the list immediately.
        </div>
      </form>
    </Modal>
  );
}

export default CreateVmModal;
