import { useAuth } from '@clerk/clerk-react'
import { useCallback } from 'react'
import { API_URL } from '@/lib/utils'

export function useApi() {
  const { getToken } = useAuth()

  const request = useCallback(
    async <T>(path: string, options?: RequestInit): Promise<T> => {
      const token = await getToken()
      const res = await fetch(`${API_URL}${path}`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...options?.headers,
        },
        ...options,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error((err as { error: string }).error ?? res.statusText)
      }
      if (res.status === 204) return undefined as T
      return res.json() as Promise<T>
    },
    [getToken],
  )

  return { request }
}
