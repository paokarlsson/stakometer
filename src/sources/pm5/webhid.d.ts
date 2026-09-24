// Minimal WebHID declarations for what the app uses (no @types package, spec §0).

interface HIDInputReportEvent extends Event {
  readonly device: HIDDevice;
  readonly reportId: number;
  readonly data: DataView;
}

interface HIDConnectionEvent extends Event {
  readonly device: HIDDevice;
}

interface HIDReportInfo {
  readonly reportId: number;
  readonly items?: readonly { readonly reportSize: number; readonly reportCount: number }[];
}

interface HIDCollectionInfo {
  readonly outputReports?: readonly HIDReportInfo[];
}

interface HIDDevice extends EventTarget {
  readonly collections: readonly HIDCollectionInfo[];
  readonly opened: boolean;
  readonly vendorId: number;
  readonly productId: number;
  readonly productName: string;
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: BufferSource): Promise<void>;
  addEventListener(type: 'inputreport', listener: (e: HIDInputReportEvent) => void): void;
  removeEventListener(type: 'inputreport', listener: (e: HIDInputReportEvent) => void): void;
}

interface HID extends EventTarget {
  getDevices(): Promise<HIDDevice[]>;
  requestDevice(options: { filters: { vendorId?: number; productId?: number }[] }): Promise<HIDDevice[]>;
  addEventListener(type: 'connect' | 'disconnect', listener: (e: HIDConnectionEvent) => void): void;
  removeEventListener(type: 'connect' | 'disconnect', listener: (e: HIDConnectionEvent) => void): void;
}

interface Navigator {
  readonly hid?: HID;
}
