export interface PairParams {
  ip: string;
  port: number | string;
  token: string;
}

export interface PairResponse {
  device_id: string;
  device_name: string;
  auth_token: string;
}
