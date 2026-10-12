export type BotStatus = 'online' | 'offline' | 'starting' | 'stopping' | 'error';
export type BotCommandType = 'start' | 'stop' | 'restart' | 'status' | 'update_code';
export type CommandStatus = 'queued' | 'running' | 'success' | 'failed';
export type OrderStatus = 'pending' | 'queued' | 'processing' | 'completed' | 'delayed' | 'failed' | 'cancelled';

export interface BotAgent {
  id: string;
  name: string;
  device_name: string;
  status: BotStatus;
  cpu_percent: number;
  memory_percent: number;
  uptime_seconds: number;
  last_heartbeat: Date | null;
  last_task_desc?: string;
  last_task_status?: 'Done' | 'Failed' | 'In Progress';
  assigned_order_id?: string | null;
  code_version?: string;
  is_active_accepting?: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface BotCommand {
  id: number;
  bot_id: string;
  command: BotCommandType;
  requested_by: string;
  status: CommandStatus;
  result?: Record<string, unknown> | null;
  created_at: Date;
  completed_at?: Date | null;
}

export interface AuditLog {
  id: number;
  actor: string;
  action: string;
  target_type: string;
  target_id?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: Date;
}

export interface Order {
  id: number;
  external_order_id: string;
  status: OrderStatus;
  amount: number;
  currency: string;
  assigned_bot_id?: string | null;
  lease_expires_at?: Date | null;
  retry_count?: number;
  failure_reason?: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface OrderEvent {
  id: number;
  order_id: number;
  event_type: string;
  payload?: Record<string, unknown> | null;
  created_at: Date;
}

export interface CodePackage {
  id: string;
  package_name: string;
  file_size_mb: number;
  sha256: string;
  source_path: string;
  components: string[];
  created_at: Date;
}

export interface OverviewSummary {
  onlineCount: number;
  activeCount: number;
  standbyCount: number;
  inProgressCount: number;
  totalMachines: number;
  killSwitchActive: boolean;
  killSwitchLabel: string;
  latestPackage: CodePackage;
}
