<template>
  <div class="panel">
    <!-- Instant protocols: unstake credits immediately -->
    <template v-if="isImmediateProtocol">
      <div class="empty-state">
        <div class="empty-icon">⏳</div>
        <p class="empty-title">No pending withdrawals</p>
        <p class="empty-desc">
          {{ protocolDisplay }} unstake completes immediately — no separate withdraw step needed.
        </p>
      </div>
    </template>

    <!-- All non-instant protocols: always show the full UI -->
    <template v-else>
      <!-- Requests List -->
      <div class="request-list">
        <div v-if="loading" class="request-list-loading">Loading withdrawal info...</div>
        <div v-else-if="withdrawalRequests.length === 0" class="request-list-empty">
          No withdrawal requests
        </div>
        <div
          v-for="(req, idx) in withdrawalRequests"
          :key="String(req.id)"
          class="request-item"
          :class="{
            pending: req.status === 'pending',
            available: req.status === 'available',
            selected: selectedRequestIndex === idx || selectedIndexes.has(idx)
          }"
          @click="selectRequest(req, idx)"
        >
          <div class="request-info">
            <span class="request-id">Request #{{ req.displayId }}</span>
            <span class="request-status" :class="req.status">
              {{ req.status === 'pending' ? 'Pending' : 'Available' }}
            </span>
          </div>
          <span class="request-amount">{{ req.formattedAmount }} {{ req.unit || claimUnit }}</span>
        </div>
      </div>

      <!-- Input area -->
      <div class="stake-wrapper">
        <div class="row">
          <span v-if="protocolId === 'meth'">Selected</span>
          <span v-else>Total Available</span>
          <span v-if="address">{{ inputAmount || '0' }} {{ claimUnit }}</span>
        </div>
        <div class="input-wrapper">
          <InputBox v-model="inputAmount" :readonly="true"/>
          <button
            v-if="protocolId !== 'meth' && protocolId !== 'stader'"
            :class="hasAvailable ? 'max active' : 'max'"
            @click="handleMax"
            :disabled="!hasAvailable"
          >
            Max
          </button>
          <div class="token-wrapper">
            <img :src="claimTokenIconUrl"/>
            <span>{{ claimUnit }}</span>
          </div>
        </div>
      </div>

      <PrimaryBtn
        v-if="address && protocolId !== 'meth'"
        :is-loading="isWithdrawing"
        :is-disabled="isWithdrawing || !hasAvailable || !selectionValid"
        @click="handleWithdraw"
      >
        {{ isWithdrawing ? 'Withdrawing...' : withdrawButtonLabel }}
      </PrimaryBtn>
      <!-- mETH: claim one by one -->
      <PrimaryBtn
        v-else-if="address && protocolId === 'meth'"
        :is-loading="isWithdrawing"
        :is-disabled="isWithdrawing || selectedRequestIndex === null"
        @click="handleWithdraw"
      >
        {{ isWithdrawing ? 'Claiming...' : 'Claim Selected' }}
      </PrimaryBtn>
      <PrimaryBtn v-else @click="walletStore.openConnect()">Connect Wallet</PrimaryBtn>

      <!-- Protocol description -->
      <div class="info">
        <div><span>Protocol</span><span>{{ protocolDisplay }}</span></div>
        <div>
          <span>Available</span>
          <span>{{ availableRequestCount }} request{{ availableRequestCount !== 1 ? 's' : '' }} ({{ totalAvailableFormatted }} {{ claimUnit }})</span>
        </div>
        <div v-if="pendingRequestCount > 0">
          <span>Pending</span>
          <span>{{ pendingRequestCount }} request{{ pendingRequestCount !== 1 ? 's' : '' }}</span>
        </div>
      </div>
    </template>

    <!-- Transaction Status Popup -->
    <TxStatusModal
      :visible="txModalVisible"
      :status="txStatus"
      :action="txAction"
      :txHash="txHash"
      :errorMessage="txError"
      :amount="inputAmount"
      asset="ETH"
      @close="closeTxModal"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import InputBox from './InputBox.vue'
import PrimaryBtn from './PrimaryBtn.vue'
import TxStatusModal from '@/components/TxStatusModal.vue'
import { storeToRefs } from 'pinia'
import { useWalletStore } from '@/stores/wallet'
import { stake } from "@/chain/stake"
import { useTxConfirmation } from "@/composables/useTxConfirmation"
import { toast } from "@/utils/toast"
import { publicClient } from "@/chain/core/provider"
import { ADDRESSES } from "@/chain/evm/addresses"
import { LIDO_WITHDRAWAL_QUEUE_ABI, STADER_UNSTAKE_ABI } from "@/chain/evm/abis"

// Withdrawal request type.
// `unit` overrides the panel-wide claimUnit when a request's amount is NOT in the claim
// currency. Stader available requests are claimable ETH; pending ones display the frozen
// ethExpected (ETH) and only fall back to the raw amountOfETHX (ETHx) when ethExpected is 0.
interface WithdrawalRequest {
  id: bigint
  displayId: string
  amount: bigint
  formattedAmount: string
  status: 'pending' | 'available'
  unit?: string
}

// Transaction Status Popup
type TxStatus = 'pending' | 'success' | 'error' | 'timeout'
type TxAction = 'withdraw'
const txModalVisible = ref(false)
const txStatus = ref<TxStatus>('pending')
const txAction = ref<TxAction>('withdraw')
const txHash = ref<string>('')
const txError = ref<string>('')

function showTxModal() {
  txAction.value = 'withdraw'
  txStatus.value = 'pending'
  txHash.value = ''
  txError.value = ''
  txModalVisible.value = true
}

function updateTxSuccess(hash: string) {
  txStatus.value = 'success'
  txHash.value = hash
}

function updateTxError(error: string) {
  txStatus.value = 'error'
  txError.value = error
}

function closeTxModal() {
  txModalVisible.value = false
}

// Confirm hook with transaction
const { waitForConfirmation } = useTxConfirmation()

// Instant protocol (unstake = withdraw, no separate step)
const IMMEDIATE_PROTOCOLS = ['rocketpool']

// Protocol display name
const PROTOCOL_DISPLAY: Record<string, string> = {
  lido: 'Lido',
  etherfi: 'ether.fi',
  rocketpool: 'Rocket Pool',
  stakewise: 'StakeWise',
  meth: 'mETH',
  stader: 'Stader',
}

const emit = defineEmits<{
  (e: 'openProcess', value: boolean, amount?: string, asset?: string): void
}>()

const props = defineProps<{
  protocol?: string
}>()

const walletStore = useWalletStore()
const { address } = storeToRefs(walletStore)

// Status
const inputAmount = ref<string>('')
const selectedRequestIndex = ref<number | null>(null)
// lido/stakewise multi-select: set of indices (into withdrawalRequests) currently selected
const selectedIndexes = ref<Set<number>>(new Set())
const claimableWei = ref<bigint>(BigInt(0))
const claimableFormatted = ref<string>('0')
const loading = ref(true)
const isWithdrawing = ref(false)

// Withdrawal request list
const withdrawalRequests = ref<WithdrawalRequest[]>([])

// Backward compatible: Lido-specific request IDs
const requestIds = ref<bigint[]>([])
// Lido request IDs that are finalized and claimable
const finalizedRequestIds = ref<bigint[]>([])
const pendingRequestCount = ref(0)

// Available requests
const availableRequests = computed(() =>
  withdrawalRequests.value.filter(r => r.status === 'available')
)
const hasAvailable = computed(() => availableRequests.value.length > 0)
const availableRequestCount = computed(() => availableRequests.value.length)

// Total available amount (formatted)
const totalAvailableFormatted = computed(() => {
  const total = availableRequests.value.reduce((sum, r) => sum + r.amount, BigInt(0))
  const f = Number(total) / 1e18
  return f > 0 ? Math.floor(f * 1e6) / 1e6 + '' : '0'
})

// lido/stakewise multi-select helpers: sum the amounts of the currently selected available requests
function selectedTotal(): bigint {
  let total = 0n
  withdrawalRequests.value.forEach((r, i) => {
    if (selectedIndexes.value.has(i) && r.status === 'available') total += r.amount
  })
  return total
}

// True when every available request is selected (the "Withdraw All Available" case)
const allAvailableSelected = computed(() => {
  let availCount = 0
  let selAvailCount = 0
  withdrawalRequests.value.forEach((r, i) => {
    if (r.status === 'available') {
      availCount++
      if (selectedIndexes.value.has(i)) selAvailCount++
    }
  })
  return availCount > 0 && selAvailCount === availCount
})

// Whether the current selection is enough to enable the withdraw button
const selectionValid = computed(() => {
  if (protocolId.value === 'meth' || protocolId.value === 'stader') {
    return selectedRequestIndex.value !== null
  }
  if (protocolId.value === 'lido' || protocolId.value === 'stakewise') {
    return selectedIndexes.value.size > 0
  }
  return true
})

// Button label: all available selected → "Withdraw All Available", otherwise "Claim Selected"
const withdrawButtonLabel = computed(() => {
  if (protocolId.value === 'meth' || protocolId.value === 'stader') return 'Claim Selected'
  if (protocolId.value === 'lido' || protocolId.value === 'stakewise') {
    return allAvailableSelected.value ? 'Withdraw All Available' : 'Claim Selected'
  }
  return 'Withdraw All Available'
})

// Agreement ID
const protocolId = computed(() => {
  return props.protocol?.toLowerCase().replace(/[\s.]/g, '') || 'lido'
})

const protocolDisplay = computed(() => {
  return PROTOCOL_DISPLAY[protocolId.value] || protocolId.value
})

// ether.fi withdrawal queue is denominated in eETH; display uniformly in weETH (converted via exchange rate)
const claimUnit = computed(() => protocolId.value === 'etherfi' ? 'weETH' : 'ETH')
const claimTokenIcon = computed(() => protocolId.value === 'etherfi' ? 'weeth.webp' : 'eth.svg')
const claimTokenIconUrl = computed(() => {
  const icons = import.meta.glob('@/assets/logos/*.{svg,webp}', { eager: true, import: 'default' })
  for (const [path, icon] of Object.entries(icons)) {
    if (path.endsWith(claimTokenIcon.value)) return icon as string
  }
  return ''
})

const isImmediateProtocol = computed(() => {
  return IMMEDIATE_PROTOCOLS.includes(protocolId.value)
})

function formatEth(wei: bigint): string {
  const f = Number(wei) / 1e18
  return f > 0 ? Math.floor(f * 1e6) / 1e6 + '' : '0'
}

// Query claimable amount
async function fetchClaimableAmount() {
  if (!address.value) {
    resetState()
    loading.value = false
    return
  }

  loading.value = true
  try {
    const adapter = stake.get(protocolId.value)
    if (!adapter?.getClaimableAmount) {
      resetState()
      return
    }

    const amount = await adapter.getClaimableAmount(address.value as `0x${string}`)
    claimableWei.value = amount

    // Format for display
    const formatted = Number(amount) / 1e18
    claimableFormatted.value = formatted > 0
      ? Math.floor(formatted * 1e6) / 1e6 + ''
      : '0'

    // EtherFi-specific: fetch all unclaimed withdrawal requests for the address via the indexer API, then distinguish pending/available per request with on-chain isFinalized
    if (protocolId.value === 'etherfi' && formatted > 0) {
      try {
        const url = `https://withdraw-request-nft-indexer.fly.dev/withdraw-request-nft/unclaimed/${address.value}`
        const res = await fetch(url)
        if (res.ok) {
          const items = await res.json() as Array<{ tokenId: string; isClaimed: boolean; amountOfEEth: string }>
          const unclaimed = items.filter(i => !i.isClaimed)
          finalizedRequestIds.value = []
          pendingRequestCount.value = 0

          // Withdrawal queue is accounted for in eETH (amountOfEEth), converted to weETH uniformly Show: 1 weETH = getRate ()/1e18 eETH
          const weEthRate = await publicClient.readContract({
            address: ADDRESSES.etherfi.weETH as `0x${string}`,
            abi: [{ name: 'getRate', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }],
            functionName: 'getRate',
            args: [],
          }) as bigint

          // WithdrawalRequestNFT.isFinalized(tokenId): finalized = past the cooldown and claimable (available), otherwise waiting (pending)
          const IS_FINALIZED_ABI = [
            { name: 'isFinalized', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'bool' }] }
          ]

          const requests: WithdrawalRequest[] = []
          let availableCount = 0

          for (const item of unclaimed) {
            const tokenId = BigInt(item.tokenId)
            const eEthWei = BigInt(item.amountOfEEth || '0')
            const weEthWei = weEthRate > 0n ? (eEthWei * 10n ** 18n) / weEthRate : eEthWei

            let finalized = false
            try {
              finalized = await publicClient.readContract({
                address: ADDRESSES.etherfi.withdrawalNFT as `0x${string}`,
                abi: IS_FINALIZED_ABI,
                functionName: 'isFinalized',
                args: [tokenId],
              }) as boolean
            } catch (err) {
              console.warn(`[Withdraw] ether.fi isFinalized failed for token ${item.tokenId}:`, err)
            }

            if (finalized) {
              availableCount++
              finalizedRequestIds.value.push(tokenId)
            }

            requests.push({
              id: tokenId,
              displayId: '#' + item.tokenId,
              amount: weEthWei,
              formattedAmount: formatEth(weEthWei),
              status: finalized ? 'available' as const : 'pending' as const,
            })
          }

          pendingRequestCount.value = requests.length - availableCount
          withdrawalRequests.value = requests

        }
      } catch (e) {
        console.warn('[Withdraw] Failed to fetch EtherFi token IDs:', e)
      }
    }

    // Lido-specific: query request IDs and distinguish finalized/pending
    if (protocolId.value === 'lido' && formatted > 0) {
      const ids = await publicClient.readContract({
        address: ADDRESSES.lido.withdrawalQueue as `0x${string}`,
        abi: LIDO_WITHDRAWAL_QUEUE_ABI,
        functionName: 'getWithdrawalRequests',
        args: [address.value as `0x${string}`]
      }) as bigint[]
      requestIds.value = ids

      // Query each request's status
      const statuses = await publicClient.readContract({
        address: ADDRESSES.lido.withdrawalQueue as `0x${string}`,
        abi: LIDO_WITHDRAWAL_QUEUE_ABI,
        functionName: 'getWithdrawalStatus',
        args: [ids]
      }) as Array<{ amountOfStETH: bigint; amountOfShares: bigint; owner: string; timestamp: bigint; isFinalized: boolean; isClaimed: boolean }>

      const finalized: bigint[] = []
      let pending = 0
      const requests: WithdrawalRequest[] = []

      for (let i = 0; i < statuses.length; i++) {
        const s = statuses[i]
        if (s.isClaimed) continue

        const status: 'pending' | 'available' = s.isFinalized ? 'available' : 'pending'
        if (s.isFinalized) {
          finalized.push(ids[i])
        } else {
          pending++
        }

        requests.push({
          id: ids[i],
          displayId: '#' + String(ids[i]),
          amount: s.amountOfStETH,
          formattedAmount: formatEth(s.amountOfStETH),
          status,
        })
      }

      finalizedRequestIds.value = finalized
      pendingRequestCount.value = pending
      withdrawalRequests.value = requests

    }

    // mETH-specific: GraphQL indexer + on-chain requestInfo to distinguish pending/claimable.
    // NOT gated by `formatted > 0` (claimable): mETH requests stay pending for ~12h+ (claimableAmount=0)
    // until finalized, so a pending-only unstake must still be listed.
    if (protocolId.value === 'meth') {
      try {
        const resp = await fetch('https://lsd-indexer2.mantle.xyz/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `query($address: String!) { unstakeRequests(where: { requester: $address, isClaimed: false }) { items { id ethAmountWei } } }`,
            variables: { address: address.value!.toLowerCase() },
          }),
        })
        const json = await resp.json()
        const items = json?.data?.unstakeRequests?.items || []

        if (items.length > 0) {
          // Check finalized status on-chain via staking.unstakeRequestInfo
          const stakingContract = '0xe3cBd06D7dadB3F4e6557bAb7EdD924CD1489E8f' as `0x${string}`
          const requests: WithdrawalRequest[] = []
          const finalized: bigint[] = []
          let pendingCount = 0

          for (const item of items) {
            const reqId = BigInt(item.id)
            const rawAmount = BigInt(item.ethAmountWei)
            try {
              const r = await publicClient.call({
                to: stakingContract,
                data: ('0xf1ec1e97' + reqId.toString(16).padStart(64, '0')) as `0x${string}`,
              })
              if (r.data && r.data !== '0x') {
                const [isFinalized, claimableAmount] = (await import('viem')).decodeAbiParameters(
                  [{ type: 'bool' }, { type: 'uint256' }], r.data
                ) as [boolean, bigint]
                const status: 'pending' | 'available' = isFinalized ? 'available' : 'pending'
                const displayAmount = isFinalized ? claimableAmount : rawAmount
                if (isFinalized) finalized.push(reqId)
                else pendingCount++
                requests.push({
                  id: reqId,
                  displayId: '#' + String(reqId),
                  amount: displayAmount,
                  formattedAmount: formatEth(displayAmount),
                  status,
                })
              }
            } catch {
              // Fallback: use the indexer amount and mark as pending
              pendingCount++
              requests.push({
                id: reqId,
                displayId: '#' + String(reqId),
                amount: rawAmount,
                formattedAmount: formatEth(rawAmount),
                status: 'pending' as const,
              })
            }
          }

          withdrawalRequests.value = requests
          finalizedRequestIds.value = finalized
          pendingRequestCount.value = pendingCount
        }
      } catch (e) {
        console.warn('[Withdraw] mETH indexer failed:', String(e).slice(0, 100))
      }
    }

    // Stader-specific: distinguish pending and claimable requests
    if (protocolId.value === 'stader' && address.value) {
      try {
        const unstakeManagerAddr = ADDRESSES.stader.unstakeManager as `0x${string}`

        // Prefer getUnstakeStatus (returns pending + claimable in one call)
        if (adapter?.getUnstakeStatus) {
          const status = await adapter.getUnstakeStatus(address.value as `0x${string}`)
          claimableWei.value = status.claimable
          const f = Number(status.claimable) / 1e18
          claimableFormatted.value = f > 0 ? Math.floor(f * 1e6) / 1e6 + '' : '0'
        }

        // Per-request details: distinguish pending vs available
        const ids = await publicClient.readContract({
          address: unstakeManagerAddr,
          abi: STADER_UNSTAKE_ABI,
          functionName: 'getRequestIdsByUser',
          args: [address.value as `0x${string}`]
        }) as bigint[]

        if (ids.length > 0) {
          const { multicall } = await import("viem/actions")
          const results = await multicall(publicClient, {
            contracts: ids.map(id => ({
              address: unstakeManagerAddr,
              abi: STADER_UNSTAKE_ABI,
              functionName: 'userWithdrawRequests',
              args: [id]
            })),
            allowFailure: false,
          })

          const requests: WithdrawalRequest[] = []
          const finalized: bigint[] = []
          let pendingCount = 0

          for (let i = 0; i < results.length; i++) {
            // userWithdrawRequests returns (owner, amountOfETHX, ethExpected, ethFinalized, blockNumber).
            // ethExpected is always > 0 for a live request → NOT a claimability flag. Claimable iff ethFinalized > 0.
            const [, amountOfETHX, ethExpected, ethFinalized] = results[i] as [string, bigint, bigint, bigint]
            if (ethFinalized > 0n) {
              // claimable: the request has been finalized by the bot, can claim ethFinalized (ETH)
              finalized.push(ids[i])
              requests.push({
                id: ids[i],
                displayId: '#' + String(ids[i]),
                amount: ethFinalized,
                formattedAmount: formatEth(ethFinalized),
                status: 'available' as const,
                unit: 'ETH',
              })
            } else if (amountOfETHX > 0n) {
              // pending: waiting for the bot. The locked amount is amountOfETHX (ETHx), but what the
              // user will actually receive is ethExpected — the ETH frozen at request time, i.e. the
              // amountOfETHX × ETHx→ETH exchange rate. Show it in ETH (the claim currency), labeled
              // by the panel's claimUnit. Fall back to the raw ETHx amount if ethExpected is 0.
              pendingCount++
              const expectEth = ethExpected > 0n
              requests.push({
                id: ids[i],
                displayId: '#' + String(ids[i]),
                amount: expectEth ? ethExpected : amountOfETHX,
                formattedAmount: formatEth(expectEth ? ethExpected : amountOfETHX),
                status: 'pending' as const,
                // ETHx amount shown as a fallback only — needs its own label, never the ETH default.
                ...(expectEth ? {} : { unit: 'ETHx' }),
              })
            }
          }

          withdrawalRequests.value = requests
          finalizedRequestIds.value = finalized
          pendingRequestCount.value = pendingCount

        }
      } catch (e) {
        console.warn('[Withdraw] Failed to fetch Stader requests:', e)
      }
    }

    // StakeWise-specific: query the exit queue via subgraph, distinguishing Exiting/Exited
    if (protocolId.value === 'stakewise' && address.value) {
      try {
        if (adapter?.getUnstakeStatus) {
          const status = await adapter.getUnstakeStatus(address.value as `0x${string}`)
          claimableWei.value = status.claimable
          const f = Number(status.claimable) / 1e18
          claimableFormatted.value = f > 0 ? Math.floor(f * 1e6) / 1e6 + '' : '0'

          // Display per ticket
          const tickets = status.tickets || []
          const requests: WithdrawalRequest[] = []
          const finalized: bigint[] = []
          let pendingCount = 0

          for (const t of tickets) {
            if (t.exitedAssets > 0n) {
              finalized.push(t.positionTicket)
              requests.push({
                id: t.positionTicket,
                displayId: '#' + String(t.positionTicket),
                amount: t.exitedAssets,
                formattedAmount: formatEth(t.exitedAssets),
                status: 'available' as const,
              })
            } else if (t.shares > 0n) {
              pendingCount++
              requests.push({
                id: t.positionTicket,
                displayId: '#' + String(t.positionTicket),
                amount: t.shares,
                formattedAmount: formatEth(t.shares),
                status: 'pending' as const,
              })
            }
          }

          withdrawalRequests.value = requests
          finalizedRequestIds.value = finalized
          pendingRequestCount.value = pendingCount

        }
      } catch (e) {
        console.warn('[Withdraw] Failed to fetch StakeWise status:', e)
      }
    }

    // lido/stakewise default: pre-select all available → button shows "Withdraw All Available"
    if (protocolId.value === 'lido' || protocolId.value === 'stakewise') {
      const set = new Set<number>()
      withdrawalRequests.value.forEach((r, i) => {
        if (r.status === 'available') set.add(i)
      })
      selectedIndexes.value = set
      inputAmount.value = formatEth(selectedTotal())
    }

  } catch (err) {
    console.warn('[Withdraw] Failed to fetch claimable amount:', err)
    resetState()
  } finally {
    loading.value = false
  }
}

function resetState() {
  claimableWei.value = BigInt(0)
  claimableFormatted.value = '0'
  requestIds.value = []
  finalizedRequestIds.value = []
  pendingRequestCount.value = 0
  withdrawalRequests.value = []
  inputAmount.value = ''
  selectedRequestIndex.value = null
  selectedIndexes.value = new Set()
}

// mETH single-select: clicking an available entry selects it and fills the amount; pending entries are not selectable
// lido/stakewise multi-select toggle (cumulative); stader/meth single-select
function selectRequest(req: WithdrawalRequest, idx: number) {
  if (req.status !== 'available') return

  if (protocolId.value === 'lido' || protocolId.value === 'stakewise') {
    const set = new Set(selectedIndexes.value)
    if (set.has(idx)) set.delete(idx)
    else set.add(idx)
    selectedIndexes.value = set
    inputAmount.value = formatEth(selectedTotal())
    return
  }

  selectedRequestIndex.value = idx
  inputAmount.value = req.formattedAmount
}

// Max button: sum all available amounts
function handleMax() {
  if (!hasAvailable.value) {
    toast.show('No available withdrawal requests', 'warning')
    return
  }

  // lido/stakewise: Max selects all available → "Withdraw All Available" (one batch tx)
  if (protocolId.value === 'lido' || protocolId.value === 'stakewise') {
    const set = new Set<number>()
    withdrawalRequests.value.forEach((r, i) => {
      if (r.status === 'available') set.add(i)
    })
    selectedIndexes.value = set
    inputAmount.value = formatEth(selectedTotal())
    return
  }

  const total = availableRequests.value.reduce((sum, r) => sum + r.amount, BigInt(0))
  inputAmount.value = formatEth(total)
}

// Run withdraw: batch claim all available requests
async function handleWithdraw() {
  if (!address.value) {
    toast.show('Please connect wallet first', 'warning')
    return
  }

  if (!hasAvailable.value) {
    toast.show('No available withdrawal requests', 'warning')
    return
  }

  isWithdrawing.value = true
  showTxModal()

  try {
    const adapter = stake.get(protocolId.value)
    if (!adapter) {
      throw new Error(`Unknown protocol: ${protocolId.value}`)
    }

    let hash: string = ''

    switch (protocolId.value) {
      case 'lido': {
        if (!adapter.withdraw) {
          throw new Error('Withdraw not supported for Lido')
        }
        const ids = [...selectedIndexes.value].map(i => withdrawalRequests.value[i].id)
        hash = await adapter.withdraw(ids, address.value as `0x${string}`)
        break
      }
      case 'etherfi': {
        if (!adapter.withdraw) {
          throw new Error('Withdraw not supported for ether.fi')
        }
        const ids = availableRequests.value.map(r => r.id)
        hash = await adapter.withdraw(ids, address.value as `0x${string}`)
        break
      }
      case 'stakewise': {
        if (!adapter.withdraw) {
          throw new Error('Withdraw not supported for StakeWise')
        }
        const stakewiseIds = [...selectedIndexes.value].map(i => withdrawalRequests.value[i].id)
        if (stakewiseIds.length === 0) {
          throw new Error('No claimable requests available')
        }
        hash = await adapter.withdraw(stakewiseIds, address.value as `0x${string}`)
        break
      }
      case 'meth': {
        if (!adapter.claim) {
          throw new Error('Claim not supported for mETH')
        }
        const selectedReq = selectedRequestIndex.value !== null
          ? withdrawalRequests.value[selectedRequestIndex.value]
          : null
        if (!selectedReq) {
          throw new Error('Please select a request to claim')
        }
        hash = await adapter.claim(address.value as `0x${string}`, selectedReq.id)
        break
      }
      case 'stader': {
        if (!adapter.withdraw) {
          throw new Error('Withdraw not supported for Stader')
        }
        // claim(uint256) enforces msg.sender == owner and cannot be batched, so claim only the
        // selected request — one tx for the clicked entry, matching the "Claim Selected" button
        // and the single-request tx record.
        const selectedReq = selectedRequestIndex.value !== null
          ? withdrawalRequests.value[selectedRequestIndex.value]
          : null
        if (!selectedReq) {
          throw new Error('Please select a request to claim')
        }
        hash = await adapter.withdraw([selectedReq.id], address.value as `0x${string}`)
        break
      }
      default: {
        throw new Error(`${protocolDisplay.value} unstake is immediate, no withdraw needed`)
      }
    }


    // Awaiting transaction confirmation
    const result = await waitForConfirmation(hash, 45000, {
      protocolId: protocolId.value,
      protocol: props.protocol || protocolId.value,
      asset: 'ETH',
      category: 'staking',
      action: 'withdraw',
      amount: inputAmount.value
    })

    if (result.success) {
      updateTxSuccess(hash)
      emit('openProcess', true, inputAmount.value, 'ETH')
      await fetchClaimableAmount()
    } else if (result.timedOut) {
      txStatus.value = 'timeout'
      txError.value = result.error || ''
    } else {
      updateTxError(result.error || 'Transaction failed on-chain')
    }
  } catch (error: any) {
    const isUserRejected =
      error?.code === 4001 ||
      error?.cause?.code === 4001 ||
      error?.message?.toLowerCase().includes('user rejected') ||
      error?.message?.toLowerCase().includes('user denied')

    if (isUserRejected) {
      txModalVisible.value = false
      toast.show('Transaction cancelled by user', 'error')
    } else {
      console.error('[Withdraw] Error:', error)
      updateTxError(error?.message || 'Transaction failed')
    }
  } finally {
    isWithdrawing.value = false
  }
}

// Watch address/protocol changes
watch(address, () => {
  fetchClaimableAmount()
})

watch(protocolId, () => {
  inputAmount.value = ''
  fetchClaimableAmount()
})

onMounted(() => {
  fetchClaimableAmount()
})
</script>

<style scoped>
.panel {
  width: 100%;
  margin: 0 auto;
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--Secondary-300, #ACB5BB);
  font-size: 14px;
}

/* Requests List */
.request-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  max-height: 240px;
  overflow-y: auto;
}

.request-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-radius: 6px;
  background: var(--Secondary-700, #161618);
  border: 1px solid var(--Secondary-600, #2C2C30);
}

.request-item.available {
  border-color: rgba(246, 215, 123, 0.3);
  cursor: pointer;
}

.request-item.selected {
  border-color: #F6D77B;
  background: rgba(246, 215, 123, 0.08);
}

.request-item.pending {
  opacity: 0.5;
  cursor: default;
}

.request-list-empty,
.request-list-loading {
  text-align: center;
  color: var(--Secondary-300, #ACB5BB);
  padding: 24px 0;
  font-size: 14px;
}

.request-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.request-id {
  color: var(--Secondary-300, #ACB5BB);
  font-family: Inter;
  font-size: 11px;
  font-weight: 400;
  line-height: 150%;
}

.request-status {
  font-family: Inter;
  font-size: 9px;
  font-weight: 600;
  line-height: 150%;
  padding: 1px 6px;
  border-radius: 3px;
}

.request-status.pending {
  color: #F6D77B;
  background: rgba(246, 215, 123, 0.1);
}

.request-status.available {
  color: #4ADE80;
  background: rgba(74, 222, 128, 0.1);
}

.request-amount {
  color: #FFF;
  font-family: Inter;
  font-size: 13px;
  font-weight: 600;
  line-height: 150%;
}

/* Empty state */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 20px;
  text-align: center;
}

.empty-icon {
  font-size: 48px;
  opacity: 0.5;
  margin-bottom: 16px;
}

.empty-title {
  color: var(--Secondary-200, #DCE4E8);
  font-family: Inter;
  font-size: 16px;
  font-weight: 600;
  line-height: 150%;
  margin-bottom: 8px;
}

.empty-desc {
  color: var(--Secondary-400, #6C7278);
  font-family: Inter;
  font-size: 12px;
  font-weight: 400;
  line-height: 150%;
  max-width: 320px;
}

/* Input area styles */
.stake-wrapper {
  width: 100%;
  display: flex;
  height: 75px;
  padding: 4.626px 10px;
  flex-direction: column;
  justify-content: center;
  align-items: flex-end;
  flex-shrink: 0;
  align-self: stretch;
  margin-bottom: 10px;
  border-radius: 4.626px;
  border: 0.771px solid var(--Secondary-600, #2C2C30);
  background: var(--Secondary-700, #161618);
}

.input-wrapper {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.token-wrapper {
  display: flex;
  align-items: center;
  gap: 4.626px;
  border-radius: 3.855px;
  background: var(--Secondary-600, #2C2C30);
  box-shadow: 0 4.626px 7.711px -2.313px rgba(0, 0, 0, 0.25);
}

.token-wrapper img {
  width: 15px;
  height: 15px;
}

.token-wrapper span {
  color: #FFF;
  font-family: Inter;
  font-size: 10.795px;
  font-style: normal;
  font-weight: 500;
  line-height: 150%;
  letter-spacing: -0.216px;
}

.row {
  margin-top: 5px;
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.row span {
  color: var(--Secondary-300, #ACB5BB);
  font-family: Inter;
  font-size: 10px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%;
  letter-spacing: -0.2px;
}

.max {
  color: var(--Secondary-200, #DCE4E8);
  text-align: center;
  font-family: Inter;
  font-size: 11px;
  font-style: normal;
  font-weight: 800;
  line-height: 150%;
  letter-spacing: -0.22px;
  padding-right: 7px;
}

.max.active {
  color: var(--Primary-Default, #FFDD94);
  text-align: center;
  font-family: Inter;
  font-size: 11px;
  font-style: normal;
  font-weight: 800;
  line-height: 150%;
  letter-spacing: -0.22px;
}

.info {
  display: flex;
  margin-top: 20px;
  padding: 7.711px;
  align-items: center;
  flex-direction: column;
  gap: 2px;
  align-self: stretch;
  border-radius: 6.169px;
  background: var(--Secondary-600, #2C2C30);
  box-shadow: 0 4.626px 7.711px -2.313px rgba(0, 0, 0, 0.25);
}

.info div {
  width: 100%;
  display: flex;
  justify-content: space-between;
}

.info div span {
  color: var(--Secondary-300, #ACB5BB);
  font-family: Inter;
  font-size: 12px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%;
  letter-spacing: -0.12px;
}
</style>
