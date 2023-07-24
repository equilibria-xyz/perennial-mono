// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "./MultiInvoker.sol";
import "../interfaces/IMultiInvokerRollup.sol";


/**
 * @title MultiInvokerRollup
 * @notice A calldata-optimized implementation of the Perennial MultiInvoker
 * @dev Supports the following encoding algorithm:

    1) List of Actions
     *  At the top-level input, the MultiInvoker takes a list of actions
     *  Each action is encoded using the below specification then concatenated together

    2) Actions
     *  First byte is the uint8 of the action's enum
     *  Rest of the data is a list of params encoded using the below specification then concatenated together

    3) Parameters
     *  uint256 - first byte is length, data is packed into smallest byte length that will fit value
     *  uint256[] - first byte is array length, each element is packed as a uint256 and concatenated together
     *  Address
        1) If address is already cached, index of the address is encoded as a uint256
        2) Otherwise the first byte is encoded as 0, and the following 20 bytes are the address
 */
contract MultiInvokerRollup is IMultiInvokerRollup, MultiInvoker {

    /// @dev Number of bytes in a uint256 type
    uint256 private constant UINT256_LENGTH = 32;

    /// @dev Number of bytes in a address type
    uint256 private constant ADDRESS_LENGTH = 20;

    /// @dev Number of bytes in a uint8 type
    uint256 private constant UINT8_LENGTH = 1;

    /// @dev Array of all stored addresses (users, products, vaults, etc) for calldata packing
    address[] public addressCache;

    /// @dev Index lookup of above array for constructing calldata
    mapping(address => uint256) public addressLookup;

    /// @dev magic byte to prepend to calldata for the fallback. 
    /// Prevents public fns from being called by arbitrary fallback data
    uint8 public constant INVOKE_ID = 73;

    /**
     * @notice Constructs the contract
     * @param usdc_ The USDC token contract address
     * @param reserve_ The DSU batcher contract address
     * @param reserve_ The DSU reserve contract address
     * @param controller_ The Perennial controller contract address
     */
    constructor(Token6 usdc_, IBatcher batcher_, IEmptySetReserve reserve_, IController controller_)
    MultiInvoker(usdc_, batcher_, reserve_, controller_)
    {
        _cacheAddress(address(0)); // Cache 0-address to avoid 0-index lookup collision
    }

    /**
     * @notice This function serves exactly the same as invoke(Invocation[] memory invocations),
     *         but includes logic to handle the highly packed calldata
     * @dev   Fallback eliminates need for 4 byte sig. MUST prepend INVOKE_ID to calldata 
     * @param input Packed data to pass to invoke logic
     * @return required no-op
     */
    fallback (bytes calldata input) external returns (bytes memory) {
        PTR memory ptr;
        if (_readUint8(input, ptr) != INVOKE_ID) revert MultiInvokerRollupMissingMagicByteError();

        _decodeFallbackAndInvoke(input, ptr);
        return "";
    }

    /**
     * @notice Processes invocation with highly packed data
     * @dev
     * Encoding Scheme:
     *   [0:1] => uint action
     *   [1:2] => uint length of current encoded type
     *   [2:length] => current encoded type (see individual type decoding functions)
     * @param input Packed data to pass to invoke logic
     */
    function _decodeFallbackAndInvoke(bytes calldata input, PTR memory ptr) internal {

        while (ptr.pos < input.length) {
            PerennialAction action = PerennialAction(_readUint8(input, ptr));

            if (action == PerennialAction.DEPOSIT) {
                address account = _readAndCacheAddress(input, ptr);
                address product = _readAndCacheAddress(input, ptr);
                UFixed18 amount = _readUFixed18(input, ptr);

                _deposit(account, IProduct(product), amount);

            } else if (action == PerennialAction.WITHDRAW) {
                address receiver = _readAndCacheAddress(input, ptr);
                address product = _readAndCacheAddress(input, ptr);
                UFixed18 amount = _readUFixed18(input, ptr);

                _withdraw(receiver, IProduct(product), amount);

            } else if (action == PerennialAction.OPEN_TAKE) {
                address product = _readAndCacheAddress(input, ptr);
                UFixed18 amount = _readUFixed18(input, ptr);

                _openTake(IProduct(product), amount);

            } else if (action == PerennialAction.CLOSE_TAKE) {
                address product = _readAndCacheAddress(input, ptr);
                UFixed18 amount = _readUFixed18(input, ptr);

                _closeTake(IProduct(product), amount);

            } else if (action == PerennialAction.OPEN_MAKE) {
                address product = _readAndCacheAddress(input, ptr);
                UFixed18 amount = _readUFixed18(input, ptr);
                
                _openMake(IProduct(product), amount);

            } else if (action == PerennialAction.CLOSE_MAKE) {
                address product = _readAndCacheAddress(input, ptr);
                UFixed18 amount = _readUFixed18(input, ptr);
                
                _closeMake(IProduct(product), amount);

            } else if (action == PerennialAction.CLAIM) {
                address product = _readAndCacheAddress(input, ptr);
                uint256[] memory programIds = _readUint256Array(input, ptr);

                _claim(IProduct(product), programIds);

            } else if (action == PerennialAction.WRAP) {
                address receiver = _readAndCacheAddress(input, ptr);
                UFixed18 amount = _readUFixed18(input, ptr);

                _wrap(receiver, amount);

            } else if (action == PerennialAction.UNWRAP) {
                address receiver = _readAndCacheAddress(input, ptr);
                UFixed18 amount = _readUFixed18(input, ptr);

                _unwrap(receiver, amount);

            } else if (action == PerennialAction.WRAP_AND_DEPOSIT) {
                address account = _readAndCacheAddress(input, ptr);
                address product = _readAndCacheAddress(input, ptr);
                UFixed18 amount = _readUFixed18(input, ptr);

                _wrapAndDeposit(account, IProduct(product), amount);

            } else if (action == PerennialAction.WITHDRAW_AND_UNWRAP) {
                address receiver = _readAndCacheAddress(input, ptr);
                address product = _readAndCacheAddress(input, ptr);
                UFixed18 amount = _readUFixed18(input, ptr);

                _withdrawAndUnwrap(receiver, IProduct(product), amount);

            } else if (action == PerennialAction.VAULT_DEPOSIT) {
                address depositer = _readAndCacheAddress(input, ptr);
                address vault = _readAndCacheAddress(input, ptr);
                UFixed18 amount = _readUFixed18(input, ptr);

                _vaultDeposit(depositer, IPerennialVault(vault), amount);

            } else if (action == PerennialAction.VAULT_REDEEM) {
                address vault = _readAndCacheAddress(input, ptr);
                UFixed18 shares = _readUFixed18(input, ptr);

                _vaultRedeem(IPerennialVault(vault), shares);

            } else if (action == PerennialAction.VAULT_CLAIM) {
                address owner = _readAndCacheAddress(input, ptr);
                address vault = _readAndCacheAddress(input, ptr);

                _vaultClaim(IPerennialVault(vault), owner);

            } else if (action == PerennialAction.VAULT_WRAP_AND_DEPOSIT) {
                address account = _readAndCacheAddress(input, ptr);
                address vault = _readAndCacheAddress(input, ptr);
                UFixed18 amount = _readUFixed18(input, ptr);

                _vaultWrapAndDeposit(account, IPerennialVault(vault), amount);

            } else if (action == PerennialAction.CHARGE_FEE) {
                address receiver = _readAndCacheAddress(input, ptr);
                UFixed18 amount = _readUFixed18(input, ptr);
                bool wrapped = _readBool(input, ptr);

                _chargeFee(receiver, amount, wrapped);
            }
        }
    }

    /**
     * @notice Unchecked sets address in cache
     * @param value Address to add to cache
     */
    function _cacheAddress(address value) private {
        uint256 index = addressCache.length;
        addressCache.push(value);
        addressLookup[value] = index;

        emit AddressAddedToCache(value, index);
    }

    /**
     * @notice Helper function to get address from calldata
     * @param input Full calldata payload
     * @param ptr Current index of input to start decoding
     * @return result The decoded address
     */
    function _readAndCacheAddress(bytes calldata input, PTR memory ptr) private returns (address result) {
        uint8 len = _readUint8(input, ptr);

        // user is new to registry, add next 20 bytes as address to registry and return address
        if (len == 0) {
            result = _bytesToAddress(input[ptr.pos:ptr.pos + ADDRESS_LENGTH]);
            ptr.pos += ADDRESS_LENGTH;

            _cacheAddress(result);
        } else {
            uint256 idx = _bytesToUint256(input, ptr.pos, len);
            ptr.pos += len;

            result = _lookupAddress(idx);
        }
    }

    /**
     * @notice Checked gets the address in cache mapped to the cache index
     * @dev There is an issue with the calldata if a txn uses cache before caching address
     * @param index The cache index
     * @return result Address stored at cache index
     */
    function _lookupAddress(uint256 index) private view returns (address result) {
        result = addressCache[index];
        if (result == address(0)) revert MultiInvokerRollupAddressIndexOutOfBoundsError();
    }

    /**
     * @notice Helper function to get bool from calldata
     * @param input Full calldata payload
     * @param ptr Current index of input to start decoding
     * @return result The decoded bool
     */
    function _readBool(bytes calldata input, PTR memory ptr) private pure returns (bool result) {
        uint8 dir = _readUint8(input, ptr);
        result = dir > 0;
    }

    /**
     * @notice Wraps next length of bytes as UFixed18
     * @param input Full calldata payload
     * @param ptr Current index of input to start decoding
     * @return result The decoded UFixed18
     */
    function _readUFixed18(bytes calldata input, PTR memory ptr) private pure returns (UFixed18 result) {
        return UFixed18.wrap(_readUint256(input, ptr));
    }

    /**
     * @notice Unpacks next length of bytes as lengths of bytes into array of uint256
     * @param input Full calldata payload
     * @param ptr Current index of input to start decoding
     * @return result ProgramIds for CLAIM action
     */
    function _readUint256Array(bytes calldata input, PTR memory ptr) private pure returns (uint256[] memory result) {
        uint8 arrayLen = _readUint8(input, ptr);

        result = new uint256[](arrayLen);
        for (uint256 i; i < arrayLen; i++) {
            result[i] = _readUint256(input, ptr);
        }
    }

    /**
     * @notice Helper function to get uint8 length from calldata
     * @param input Full calldata payload
     * @param ptr Current index of input to start decoding
     * @return result The decoded uint8 length
     */
    function _readUint8(bytes calldata input, PTR memory ptr) private pure returns (uint8 result) {
        result = _bytesToUint8(input, ptr.pos);
        ptr.pos += UINT8_LENGTH;
    }

    /**
     * @notice Helper function to get uint256 from calldata
     * @param input Full calldata payload
     * @param ptr Current index of input to start decoding
     * @return result The decoded uint256
     */
    function _readUint256(bytes calldata input, PTR memory ptr) private pure returns (uint256 result) {
        uint8 len = _readUint8(input, ptr);
        if (len > UINT256_LENGTH) revert MultiInvokerRollupInvalidUint256LengthError();

        result = _bytesToUint256(input, ptr.pos, len);
        ptr.pos += len;
    }

    /**
     * @notice Implementation of GNSPS' standard BytesLib.sol
     * @param input 1 byte slice to convert to uint8 to decode lengths
     * @return result The uint8 representation of input
     */
    function _bytesToUint8(bytes calldata input, uint256 pos) private pure returns (uint8 result) {
        assembly {
            // 1) load calldata into temp starting at ptr position 
            let temp := calldataload(add(input.offset, pos))
            // 2) shifts the calldata such that only the first byte is stored in result
            result := shr(mul(8, sub(UINT256_LENGTH, UINT8_LENGTH)), temp)
        }
    }

    /**
     * @dev This is called in decodeAccount and decodeProduct which both only pass 20 byte slices
     * @notice Unchecked force of 20 bytes into address
     * @param input The 20 bytes to be converted to address
     * @return result Address representation of `input`
    */
    function _bytesToAddress(bytes memory input) private pure returns (address result) {
        assembly {
            result := mload(add(input, ADDRESS_LENGTH))
        }
    }

    /**
     * @notice Unchecked loads arbitrarily-sized bytes into a uint
     * @dev Bytes length enforced as < max word size
     * @param input The bytes to convert to uint256
     * @return result The resulting uint256
     */
    function _bytesToUint256(bytes calldata input, uint256 pos, uint256 len) private pure returns (uint256 result) {
        assembly {
            // 1) load the calldata into result starting at the ptr position
            result := calldataload(add(input.offset, pos))
            // 2) shifts the calldata such that only the next length of bytes specified by `len` populates the uint256 result
            result := shr(mul(8, sub(UINT256_LENGTH, len)), result) 
        }
    }
}
