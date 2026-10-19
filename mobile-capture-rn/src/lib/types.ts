export interface CaptureConfig {
  baseUrl: string;
  userId: string;
  secret: string;
  notificationEnabled: boolean;
  smsEnabled: boolean;
  appFilters: string;
  smsFilters: string;
  locationEnabled: boolean;
}

export interface PaymentLocation {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  capturedAt: string;
}

export interface IngestEvent {
  eventId: string;
  channel: "notification" | "sms";
  message: string;
  appOrSender: string | null;
  capturedAt: string;
  location?: PaymentLocation | null;
}
