import {
  Alert,
  App as AntdApp,
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
import { HardDriveIcon, InfoIcon, PlusIcon, ServerIcon } from "./icons";

export interface CreateVmModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (sandbox: { id: string; name: string }) => void;
}

interface CreateVmFormValues {
  image: string;
  name?: string;
  vcpus: number;
  memory_mb: number;
  no_auto_sleep: boolean;
}

const DEFAULT_VALUES: Partial<CreateVmFormValues> = {
  vcpus: 2,
  memory_mb: 512,
  no_auto_sleep: false,
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
