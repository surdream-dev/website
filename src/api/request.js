/**
 * API request encapsulation
 * Unified request and error handling
 */

import { API_BASE_URL, API_TIMEOUT, API_ENDPOINTS } from '@/config/api'

/**
 * Generic request method
 * @param {string} endpoint - API endpoint
 * @param {object} options - fetch options
 * @returns {Promise<any>} response data
 */
export async function request(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`

  const config = {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    ...options,
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT)

    const response = await fetch(url, {
      ...config,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`)
    }

    const data = await response.json()

    // Unified processing of return codes
    if (data.code !== 0) {
      throw new Error(data.msg || 'Request failed')
    }

    return data.data
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timeout')
    }
    console.error(`API Request Error [${endpoint}]:`, error)
    throw error
  }
}

/**
 * get request
 * @param {string} endpoint - API endpoint
 * @param {object} params - Query parameters
 * @returns {Promise<any>}
 */
export async function get(endpoint, params = {}) {
  const queryString = new URLSearchParams(params).toString()
  const url = queryString ? `${endpoint}?${queryString}` : endpoint
  return request(url)
}

/**
 * post request
 * @param {string} endpoint - API endpoint
 * @param {object} body - request body
 * @returns {Promise<any>}
 */
export async function post(endpoint, body = {}) {
  return request(endpoint, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// = = = = = Token management (inline avoids circular references with auth.js) = = = = =

function getRefreshToken() {
  return localStorage.getItem('surdream_refresh_token')
}

function saveTokens(accessToken, refreshToken) {
  localStorage.setItem('surdream_access_token', accessToken)
  if (refreshToken) {
    localStorage.setItem('surdream_refresh_token', refreshToken)
  }
}

export function clearAuthTokens() {
  localStorage.removeItem('surdream_access_token')
  localStorage.removeItem('surdream_refresh_token')
}

/**
 * Attempt to refresh access token
 * @returns {Promise<string|null>} new access token, failed to return null
 */
async function refreshAccessToken() {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return null

  try {
    const data = await request(API_ENDPOINTS.AUTH_REFRESH, {
      method: 'POST',
      body: JSON.stringify({ refreshToken })
    })
    saveTokens(data.accessToken, data.refreshToken)
    return data.accessToken
  } catch {
    // Refresh failed, clear token (backend needs/auth/refresh interface)
    clearAuthTokens()
    return null
  }
}

// Verification Requests

/**
 * Requests with authentication (JWT tokens added automatically, refreshed automatically on 401)
 * @param {string} endpoint - API endpoint
 * @param {object} options - fetch options
 * @param {boolean} retried - whether retried (for internal use)
 * @returns {Promise<any>}
 */
export async function authRequest(endpoint, options = {}, retried = false) {
  const token = localStorage.getItem('surdream_access_token')

  if (!token) {
    throw new Error('No access token found')
  }

  try {
    const response = await request(endpoint, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${token}`,
      },
    })
    return response
  } catch (error) {
    // If it is 401 and not retried, try refreshing the token
    if (!retried && error.message === 'HTTP Error: 401') {
      const newToken = await refreshAccessToken()
      if (newToken) {
        return authRequest(endpoint, options, true)
      }
    }
    throw error
  }
}

/**
 * get request with authentication
 * @param {string} endpoint - API endpoint
 * @param {object} params - query parameters
 * @returns {Promise<any>}
 */
export async function authGet(endpoint, params = {}) {
  const queryString = new URLSearchParams(params).toString()
  const url = queryString ? `${endpoint}?${queryString}` : endpoint
  return authRequest(url, { method: 'GET' })
}

/**
 * Post request with authentication
 * @param {string} endpoint - API endpoint
 * @param {object} body - request body
 * @returns {Promise<any>}
 */
export async function authPost(endpoint, body = {}) {
  return authRequest(endpoint, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
