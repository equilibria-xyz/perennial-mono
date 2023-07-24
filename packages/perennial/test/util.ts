import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { constants, utils, BigNumberish, BigNumber } from 'ethers'
import { IMultiInvoker, MultiInvokerRollup } from '../types/generated'

export const MAGIC_BYTE = '0x49'

export type InvokerAction =
  | 'NOOP'
  | 'DEPOSIT'
  | 'WITHDRAW'
  | 'OPEN_TAKE'
  | 'CLOSE_TAKE'
  | 'OPEN_MAKE'
  | 'CLOSE_MAKE'
  | 'CLAIM'
  | 'WRAP'
  | 'UNWRAP'
  | 'WRAP_AND_DEPOSIT'
  | 'WITHDRAW_AND_UNWRAP'
  | 'VAULT_DEPOSIT'
  | 'VAULT_REDEEM'
  | 'VAULT_CLAIM'
  | 'VAULT_WRAP_AND_DEPOSIT'
  | 'CHARGE_FEE'

export const buildInvokerActions = ({
  userAddress,
  productAddress,
  position,
  amount,
  programs,
  vaultAddress = constants.AddressZero,
  vaultAmount = 0,
  feeAmount,
  wrappedFee,
}: {
  userAddress: string
  productAddress: string
  position: BigNumberish
  amount: BigNumberish
  programs: number[]
  vaultAddress?: string
  vaultAmount?: BigNumberish
  feeAmount?: BigNumberish
  wrappedFee?: boolean
}): { [action in InvokerAction]: IMultiInvoker.InvocationStruct } => {
  return {
    NOOP: {
      action: 0,
      args: '0x',
    },
    DEPOSIT: {
      action: 1,
      args: utils.defaultAbiCoder.encode(['address', 'address', 'uint'], [userAddress, productAddress, amount]),
    },
    WITHDRAW: {
      action: 2,
      args: utils.defaultAbiCoder.encode(['address', 'address', 'uint'], [userAddress, productAddress, amount]),
    },
    OPEN_TAKE: {
      action: 3,
      args: utils.defaultAbiCoder.encode(['address', 'uint'], [productAddress, position]),
    },
    CLOSE_TAKE: {
      action: 4,
      args: utils.defaultAbiCoder.encode(['address', 'uint'], [productAddress, position]),
    },
    OPEN_MAKE: {
      action: 5,
      args: utils.defaultAbiCoder.encode(['address', 'uint'], [productAddress, position]),
    },
    CLOSE_MAKE: {
      action: 6,
      args: utils.defaultAbiCoder.encode(['address', 'uint'], [productAddress, position]),
    },
    CLAIM: {
      action: 7,
      args: utils.defaultAbiCoder.encode(['address', 'uint[]'], [productAddress, programs]),
    },
    WRAP: {
      action: 8,
      args: utils.defaultAbiCoder.encode(['address', 'uint'], [userAddress, amount]),
    },
    UNWRAP: {
      action: 9,
      args: utils.defaultAbiCoder.encode(['address', 'uint'], [userAddress, amount]),
    },
    WRAP_AND_DEPOSIT: {
      action: 10,
      args: utils.defaultAbiCoder.encode(['address', 'address', 'uint'], [userAddress, productAddress, amount]),
    },
    WITHDRAW_AND_UNWRAP: {
      action: 11,
      args: utils.defaultAbiCoder.encode(['address', 'address', 'uint'], [userAddress, productAddress, amount]),
    },
    VAULT_DEPOSIT: {
      action: 12,
      args: utils.defaultAbiCoder.encode(['address', 'address', 'uint'], [userAddress, vaultAddress, vaultAmount]),
    },
    VAULT_REDEEM: {
      action: 13,
      args: utils.defaultAbiCoder.encode(['address', 'uint'], [vaultAddress, vaultAmount]),
    },
    VAULT_CLAIM: {
      action: 14,
      args: utils.defaultAbiCoder.encode(['address', 'address'], [userAddress, vaultAddress]),
    },
    VAULT_WRAP_AND_DEPOSIT: {
      action: 15,
      args: utils.defaultAbiCoder.encode(['address', 'address', 'uint'], [userAddress, vaultAddress, vaultAmount]),
    },
    CHARGE_FEE: {
      action: 16,
      args: utils.defaultAbiCoder.encode(['address', 'uint', 'bool'], [vaultAddress, feeAmount, wrappedFee]),
    },
  }
}

export const buildAllActionsRollup = (
  actions: {
    action: BigNumberish
    payload: string
  }[],
  // actions: {
  //   action: InvokerAction
  //   userCache: BigNumber | null,
  //   productCache: BigNumber,
  //   userAddress?: string,
  //   productAddress?: string,
  //   position?: BigNumberish,
  //   amount?: BigNumberish,
  //   programs?: number[]
  // }[]
): string => {
  let pld = MAGIC_BYTE

  for (const a of actions) {
    if (a.payload == MAGIC_BYTE) {
      continue
    }
    // remove magic byte from each action when multiple actions
    pld += a.payload.substring(4)
  }

  return pld
}

export const buildInvokerActionRollup = (
  userCache: BigNumber, // BN(0) if not used
  productCache: BigNumber, // BN(0) if not used
  vaultCache: BigNumber, // BN(0) if not used
  userAddress?: string,
  productAddress?: string,
  vaultAddress?: string,
  position?: BigNumberish,
  amount?: BigNumberish,
  vaultAmount?: BigNumberish,
  feeAmount?: BigNumberish,
  wrappedFee?: boolean,
  programs?: number[],
): { [action in InvokerAction]: { action: BigNumberish; payload: string } } => {
  return {
    NOOP: {
      action: 0,
      payload: MAGIC_BYTE,
    },
    DEPOSIT: {
      action: 1,
      // [userAddress productAddress amount]
      payload:
        MAGIC_BYTE +
        '01' +
        encodeAddressOrCacheIndex(userCache, userAddress) +
        encodeAddressOrCacheIndex(productCache, productAddress) +
        encodeUint(BigNumber.from(amount)),
    },
    WITHDRAW: {
      action: 2,
      // [userAddress productAddress amount]
      payload:
        MAGIC_BYTE +
        '02' +
        encodeAddressOrCacheIndex(userCache, userAddress) +
        encodeAddressOrCacheIndex(productCache, productAddress) +
        encodeUint(BigNumber.from(amount)),
    },
    OPEN_TAKE: {
      action: 3,
      // [productAddress position]
      payload:
        MAGIC_BYTE +
        '03' +
        encodeAddressOrCacheIndex(productCache, productAddress) +
        encodeUint(BigNumber.from(position)),
    },
    CLOSE_TAKE: {
      action: 4,
      // [productAddress position]
      payload:
        MAGIC_BYTE +
        '04' +
        encodeAddressOrCacheIndex(productCache, productAddress) +
        encodeUint(BigNumber.from(position)),
    },
    OPEN_MAKE: {
      action: 5,
      // [productAddress position]
      payload:
        MAGIC_BYTE +
        '05' +
        encodeAddressOrCacheIndex(productCache, productAddress) +
        encodeUint(BigNumber.from(position)),
    },
    CLOSE_MAKE: {
      action: 6,
      // [productAddress position]
      payload:
        MAGIC_BYTE +
        '06' +
        encodeAddressOrCacheIndex(productCache, productAddress) +
        encodeUint(BigNumber.from(position)),
    },
    CLAIM: {
      action: 7,
      // [productAddress programs]
      payload:
        MAGIC_BYTE + '07' + encodeAddressOrCacheIndex(productCache, productAddress) + encodeProgramIds(programs!),
    },
    WRAP: {
      action: 8,
      // [userAddress amount]
      payload:
        MAGIC_BYTE + '08' + encodeAddressOrCacheIndex(userCache, userAddress) + encodeUint(BigNumber.from(amount)),
    },
    UNWRAP: {
      action: 9,
      // [userAddress amount]
      payload:
        MAGIC_BYTE + '09' + encodeAddressOrCacheIndex(userCache, userAddress) + encodeUint(BigNumber.from(amount)),
    },
    WRAP_AND_DEPOSIT: {
      action: 10,
      // [userAddress, productAddress, amount]
      payload:
        MAGIC_BYTE +
        '0A' +
        encodeAddressOrCacheIndex(userCache, userAddress) +
        encodeAddressOrCacheIndex(productCache, productAddress) +
        encodeUint(BigNumber.from(amount)),
    },
    WITHDRAW_AND_UNWRAP: {
      action: 11,
      // [userAddress, productAddress, amount]
      payload:
        MAGIC_BYTE +
        '0B' +
        encodeAddressOrCacheIndex(userCache, userAddress) +
        encodeAddressOrCacheIndex(productCache, productAddress) +
        encodeUint(BigNumber.from(amount)),
    },
    VAULT_DEPOSIT: {
      action: 12,
      payload:
        MAGIC_BYTE +
        '0C' +
        encodeAddressOrCacheIndex(userCache, userAddress) +
        encodeAddressOrCacheIndex(vaultCache, vaultAddress) +
        encodeUint(BigNumber.from(vaultAmount)),
    },
    VAULT_REDEEM: {
      action: 13,
      payload:
        MAGIC_BYTE +
        '0D' +
        encodeAddressOrCacheIndex(vaultCache, vaultAddress) +
        encodeUint(BigNumber.from(vaultAmount)),
    },
    VAULT_CLAIM: {
      action: 14,
      payload:
        MAGIC_BYTE +
        '0E' +
        encodeAddressOrCacheIndex(userCache, userAddress) +
        encodeAddressOrCacheIndex(vaultCache, vaultAddress),
    },
    VAULT_WRAP_AND_DEPOSIT: {
      action: 15,
      payload:
        MAGIC_BYTE +
        '0F' +
        encodeAddressOrCacheIndex(userCache, userAddress) +
        encodeAddressOrCacheIndex(vaultCache, vaultAddress) +
        encodeUint(BigNumber.from(vaultAmount)),
    },
    CHARGE_FEE: {
      action: 16,
      payload:
        MAGIC_BYTE +
        `10` +
        encodeAddressOrCacheIndex(vaultCache, vaultAddress) +
        encodeUint(BigNumber.from(feeAmount)) +
        (wrappedFee ? `01` : `00`),
    },
  }
}

export const encodeUint = (uint: BigNumber) => {
  if (uint.eq(0)) return '0100'
  return toHex((uint._hex.length - 2) / 2) + toHex(uint._hex)
}

export const encodeAddressOrCacheIndex = (
  cacheIndex: BigNumber, // must not be null, default to BN(0) and pass address if user's first interaction with protocol
  address?: string,
) => {
  // include address if first interaction with the protocol,
  // contract reads the next 20 bytes into an address when given an address length of 0
  if (address) return '00' + address.slice(2)

  //
  return encodeUint(cacheIndex)
}

export const encodeProgramIds = (programs: number[]) => {
  let encoded = toHex(BigNumber.from(programs.length))

  programs.forEach(program => {
    encoded += encodeUint(BigNumber.from(program))
  })

  return encoded
}

function toHex(input: BigNumberish): string {
  return BigNumber.from(input)._hex.slice(2)
}
