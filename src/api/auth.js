/** Auth API - Web3 Login */

import { post } from './request'
import { API_ENDPOINTS } from '@/config/api'

/**
 * Get Signature Challenge
 * @param {object} payload - Request Body
 * @param {string} payload.chainType - Chain Type (evm/solana)
 * @param {string} payload.address - Wallet Address
 * @param {number} payload.chainId - EVM Chain ID
 * @param {string} payload.cluster - Solana cluster
 * @param {string} payload.walletType - Wallet Type
 * @returns {Promise < {nonce: string, message: string} >}
 */
export async function getChallenge(payload) {
  return post(API_ENDPOINTS.AUTH_CHALLENGE, payload)
}

/**
 * Web3 login
 * @param {object} payload - Request body
 * @param {string} payload.chainType - Chain type
 * @param {string} payload.address - Wallet address
 * @param {string} payload.signature - Signature
 * @param {string} payload.nonce - nonce
 * @returns {Promise < {user: object, token: object} >}
 */
export async function login(payload) {
  return post(API_ENDPOINTS.AUTH_LOGIN, payload)
}

/**
 * Save token to local store
 * @param {string} accessToken - access token
 * @param {string} refreshToken - refresh token
 */
export function saveTokens(accessToken, refreshToken) {
  localStorage.setItem('surdream_access_token', accessToken)
  localStorage.setItem('surdream_refresh_token', refreshToken)
}

/**
 * Get locally stored tokens
 * @returns {string | null}
 */
export function getAccessToken() {
  return localStorage.getItem('surdream_access_token')
}

/** Clear Token */
export function clearTokens() {
  localStorage.removeItem('surdream_access_token')
  localStorage.removeItem('surdream_refresh_token')
}

/**
 * Check if logged in
 * @returns {boolean}
 */
export function isLoggedIn() {
  return !!getAccessToken()
}
