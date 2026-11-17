import {
  Alert,
  App as AntdApp,
  Button,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
  Tooltip,
} from "antd";
import { useState } from "react";
import type { ReactNode } from "react";
import type { CreateSandboxInput } from "../lib/api";
import { useCreateSandbox, useImages } from "../lib/queries";
import { describeError } from "../utils/errors";
import { formatBytes, imageLabel } from "../utils/format";
import { HardDriveIcon, InfoIcon, PlusIcon, ServerIcon, TrashIcon } from "./icons";

export interface CreateVmModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (sandbox: { id: string; name: string }) => void;
}

interface VolumeFormValue {
  host_path?: string;
  guest_path?: string;
  read_only?: boolean;
}

interface CreateVmFormValues {
  image: string;
  name?: string;
  vcpus: number;
  memory_mb: number;
  no_auto_sleep: boolean;
  volumes?: VolumeFormValue[];
}

const DEFAULT_VALUES: Partial<CreateVmFormValues> = {
  vcpus: 2,
  memory_mb: 512,
  no_auto_sleep: false,
  volumes: [],
};

/** Create-sandbox dialog: image, optional name, vCPUs, memory and auto-sleep. */
export function CreateVmModal({ open, onClose, onCreated }: CreateVmModalProps) {
  const { message } = AntdApp.useApp();
  const images = useImages();
  const createSandbox = useCreateSandbox();
  const [form] = Form.useForm<CreateVmFormValues>();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isCreating = createSandbox.isPending;
  const imageList = images.data ?? [];
  const noImages = !images.isPending && images.isError === false && imageList.length === 0;

  const handleCancel = () => {
    if (isCreating) {
      return;
    }
    setSubmitError(null);
    onClose();
  };

  const handleFinish = async (values: CreateVmFormValues) => {
    setSubmitError(null);
    const trimmedName = values.name?.trim() ?? "";
    const input: CreateSandboxInput = {
      image: values.image,
      vcpus: values.vcpus,
      memory_mb: values.memory_mb,
      no_auto_sleep: values.no_auto_sleep,
    };
    if (trimmedName !== "") {
      input.name = trimmedName;
    }
    const volumes = (values.volumes ?? []).flatMap((volume) => {
      const hostPath = volume.host_path?.trim() ?? "";
      const guestPath = volume.guest_path?.trim() ?? "";
      if (hostPath === "" || guestPath === "") {
        return [];
      }
      return [
        {
          host_path: hostPath,
          guest_path: guestPath,
          read_only: volume.read_only === true,
        },
      ];
    });
    if (volumes.length > 0) {
      input.volumes = volumes;
    }
    try {
      const created = await createSandbox.mutateAsync(input);
      message.success(`Sandbox ${created.name} is being created`);
      form.resetFields();
      onCreated?.({ id: created.id, name: created.name });
      onClose();
    } catch (error) {
      const description = describeError(error);
      setSubmitError(description);
      message.error(description);
    }
  };

  let imageFieldExtra: ReactNode;
  if (images.isError) {
    imageFieldExtra = (
      <Alert
        type="error"
        showIcon
        title="Could not load base images"
        description={describeError(images.error)}
      />
    );
  } else if (noImages) {
    imageFieldExtra = (
      <Alert
        type="warning"
        showIcon
        title="No base disk images available"
        description="Build an image first (for example `make image` in the repository root), then reopen this dialog."
      />
    );
  } else {
    imageFieldExtra = (
      <span className="form-hint">
        <HardDriveIcon /> Base disks are read-only; each VM gets a copy-on-write volume.
      </span>
    );
  }

  return (
    <Modal
      open={open}
      onCancel={handleCancel}
      onOk={() => {
        form.submit();
      }}
      okText="Create VM"
      cancelText="Cancel"
      confirmLoading={isCreating}
      cancelButtonProps={{ disabled: isCreating }}
      closable={!isCreating}
      keyboard={!isCreating}
      mask={{ closable: !isCreating }}
      width={620}
      title={
        <span className="modal-title">
          <span className="modal-title-icon">
            <ServerIcon />
          </span>
          Create virtual machine
        </span>
      }
    >
      <Form<CreateVmFormValues>
        form={form}
        layout="vertical"
        className="create-vm-form"
        initialValues={DEFAULT_VALUES}
        onFinish={(values) => {
          void handleFinish(values);
        }}
        disabled={isCreating}
        requiredMark={false}
      >
        <Form.Item
          name="image"
          label="Base image"
          rules={[{ required: true, message: "Choose a base disk image." }]}
          extra={imageFieldExtra}
        >
          <Select
            placeholder={images.isPending ? "Loading images…" : "Select an image"}
            loading={images.isPending}
            disabled={images.isPending || noImages}
            showSearch
            optionFilterProp="label"
            options={imageList.map((image) => ({
              value: image.digest,
              label: `${imageLabel(image)} · ${formatBytes(image.size_bytes)}`,
            }))}
            notFoundContent={images.isPending ? "Loading…" : "No images found"}
          />
        </Form.Item>

        <Form.Item
          name="name"
          label="Name (optional)"
          rules={[
            { max: 63, message: "Keep the name to 63 characters or fewer." },
            {
              pattern: /^[A-Za-z0-9._-]+$/,
              message: "Use letters, numbers, dots, dashes or underscores.",
            },
          ]}
        >
          <Input placeholder="auto: sb-…" autoComplete="off" />
        </Form.Item>

        <div className="create-vm-row">
          <Form.Item
            name="vcpus"
            label="vCPUs"
            rules={[{ required: true, message: "Set the vCPU count." }]}
          >
            <InputNumber min={1} max={8} step={1} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="memory_mb"
            label="Memory (MB)"
            rules={[{ required: true, message: "Set the memory size." }]}
          >
            <InputNumber min={64} max={4096} step={64} precision={0} style={{ width: "100%" }} />
          </Form.Item>
        </div>

        <Form.List name="volumes">
          {(fields, { add, remove }) => (
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 8,
                  fontWeight: 600,
                }}
              >
                <HardDriveIcon /> Host volumes (virtio-fs)
              </div>
              <p style={{ margin: "4px 0 0", color: "var(--text-5)", fontSize: 11.5 }}>
                Mount host directories into the guest. fastvmd enforces the configured
                <code> volumes.allowed_host_prefixes</code> allowlist.
              </p>
              <Flex vertical gap={0} style={{ marginTop: 8 }}>
                {fields.map(({ key, name, ...restField }) => (
                  <Flex key={key} gap={8} align="flex-end" wrap>
                    <Form.Item
                      {...restField}
                      name={[name, "host_path"]}
                      label="Host path"
                      rules={[
                        { required: true, message: "Host path is required." },
                        {
                          pattern: /^\//,
                          message: "Host path must be absolute (start with /).",
                        },
                      ]}
                      style={{ flex: "1 1 170px", marginBottom: 8 }}
                    >
                      <Input placeholder="/host/dir" autoComplete="off" />
                    </Form.Item>
                    <Form.Item
                      {...restField}
                      name={[name, "guest_path"]}
                      label="Guest mount"
                      rules={[
                        { required: true, message: "Guest mount is required." },
                        {
                          pattern: /^\/[^\s:,]*$/,
                          message: "Absolute path, no spaces, ':' or ','.",
                        },
                      ]}
                      style={{ flex: "1 1 150px", marginBottom: 8 }}
                    >
                      <Input placeholder="/mnt/data" autoComplete="off" />
                    </Form.Item>
                    <Form.Item
                      {...restField}
                      name={[name, "read_only"]}
                      label="Read-only"
                      valuePropName="checked"
                      style={{ marginBottom: 8 }}
                    >
                      <Switch aria-label="Read-only volume" />
                    </Form.Item>
                    <Form.Item style={{ marginBottom: 8 }}>
                      <Button
                        type="text"
                        danger
                        aria-label="Remove volume"
                        disabled={isCreating}
                        onClick={() => remove(name)}
                      >
                        <TrashIcon />
                      </Button>
                    </Form.Item>
                  </Flex>
                ))}
              </Flex>
              <Button
                type="dashed"
                block
                icon={<PlusIcon />}
                style={{ marginBottom: 16 }}
                disabled={isCreating}
                onClick={() => add({ read_only: false })}
              >
                Add volume
              </Button>
            </div>
          )}
        </Form.List>

        <Form.Item
          name="no_auto_sleep"
          label={
            <span className="switch-label">
              Disable automatic sleep
              <Tooltip title="When enabled, fastvmd keeps this sandbox awake even when it is idle. It uses host resources continuously.">
                <InfoIcon className="switch-label-icon" />
              </Tooltip>
            </span>
          }
          valuePropName="checked"
        >
          <Switch checkedChildren="On" unCheckedChildren="Off" />
        </Form.Item>

        {submitError !== null ? (
          <Alert className="create-vm-error" type="error" showIcon title={submitError} />
        ) : null}

        <div className="create-vm-footnote">
          <PlusIcon /> The sandbox boots from a copy-on-write volume and appears in the list
          immediately.
        </div>
      </Form>
    </Modal>
  );
}

export default CreateVmModal;
