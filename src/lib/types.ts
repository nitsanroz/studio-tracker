export type Role = "admin" | "designer";

export interface Profile {
  id: string;
  name: string;
  role: Role;
  avatarUrl: string | null;
  active: boolean;
}

export interface Client {
  id: string;
  name: string;
  color: string;
  billingPeriodNote: string;
  archived: boolean;
}

export interface Project {
  id: string;
  clientId: string;
  name: string;
  billable: boolean;
  archived: boolean;
}

export interface Section {
  id: string;
  projectId: string;
  name: string;
  position: number;
}

export type TaskStatus = "todo" | "in_progress" | "done";

export interface Task {
  id: string;
  projectId: string;
  sectionId: string | null;
  title: string;
  brief: string;
  figmaUrl: string | null;
  status: TaskStatus;
  tag: string | null;
  assigneeId: string | null;
  dueDate: string | null;
  billable: boolean;
  estimateHours: number | null;
  position: number;
  /** true while a client intake request is approved-pending confirmation */
  pending?: boolean;
}

export interface TaskComment {
  id: string;
  taskId: string;
  userId: string;
  body: string;
  createdAt: string;
}

export interface Attachment {
  id: string;
  taskId: string;
  fileName: string;
  filePath: string;
  sizeBytes: number;
  uploadedBy: string | null;
}

export interface TimeEntry {
  id: string;
  taskId: string;
  userId: string;
  date: string;
  minutes: number;
  description: string;
  movedFromTaskId: string | null;
}

export type PlanEntryType = "task" | "free_text" | "absence";
export type AbsenceType = "vacation" | "sick" | "day_off" | "half_day" | "wfh";

export interface PlanColumn {
  id: string;
  name: string;
  profileId: string | null;
  position: number;
  type: "member" | "waiting_list" | "studio";
  hidden: boolean;
}

export interface PlanEntry {
  id: string;
  date: string | null; // yyyy-mm-dd; null = waiting list
  columnId: string;
  position: number;
  type: PlanEntryType;
  taskId: string | null;
  text: string;
  clientId: string | null;
  absenceType: AbsenceType | null;
}
