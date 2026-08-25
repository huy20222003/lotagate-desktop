import { z } from 'zod';

export const userProfileSchema = z.object({
  id: z.string(),
  email: z.string(),
  username: z.string().nullable().optional(),
  fullName: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  defaultOrganizationCode: z.string().nullable().optional(),
  defaultWorkspaceCode: z.string().nullable().optional(),
  organizations: z.array(z.object({
    id: z.string(),
    organizationCode: z.string(),
    displayName: z.string(),
    type: z.string().optional(),
    status: z.string().optional(),
    role: z.string().optional(),
    workspaces: z.array(z.object({ id: z.string(), workspaceCode: z.string(), displayName: z.string(), status: z.string().optional() })).default([]),
  })).default([]),
});

export type UserProfile = z.infer<typeof userProfileSchema>;

export const loginInputSchema = z.object({
  usernameOrEmail: z.string().trim().min(1),
  password: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginInputSchema>;

export type AuthErrorCode =
  | 'API_NOT_CONFIGURED'
  | 'AUTH_REQUIRED'
  | 'AUTH_FAILED'
  | 'AUTH_UNSUPPORTED'
  | 'API_UNAVAILABLE'
  | 'API_PROTOCOL_ERROR';

export interface AuthErrorPayload {
  code: AuthErrorCode;
  message: string;
  retryable: boolean;
}

export interface DesktopAuthApi {
  getCurrentUser(): Promise<UserProfile | null>;
  login(input: LoginInput): Promise<UserProfile>;
  logout(): Promise<void>;
}

export interface DesktopRendererAuthApi extends DesktopAuthApi {
  onSessionExpired(listener: () => void): () => void;
}
