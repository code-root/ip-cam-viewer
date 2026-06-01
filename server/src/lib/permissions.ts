import type { Role } from '@prisma/client';

export type Permission =
  | 'view_streams'
  | 'ptz'
  | 'manage_cameras'
  | 'recordings_write'
  | 'recordings_read'
  | 'manage_users'
  | 'notifications'
  | 'backup'
  | 'talk_back'
  | 'imaging'
  | 'privacy_masks'
  | 'manage_employees'
  | 'view_attendance';

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [
    'view_streams',
    'ptz',
    'manage_cameras',
    'recordings_write',
    'recordings_read',
    'manage_users',
    'notifications',
    'backup',
    'talk_back',
    'imaging',
    'privacy_masks',
    'manage_employees',
    'view_attendance',
  ],
  operator: [
    'view_streams',
    'ptz',
    'recordings_write',
    'recordings_read',
    'talk_back',
    'imaging',
    'privacy_masks',
    'view_attendance',
    'manage_employees',
  ],
  viewer: ['view_streams', 'recordings_read', 'view_attendance'],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
