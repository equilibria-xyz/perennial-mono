// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./MultiInvoker.sol";
import "../interfaces/IMultiInvokerRollup.sol";

/// @title A calldata-optimized implementation of the Perennial MultiInvoker 
/// @notice Retains same functionality and `invoke` entry point from inherited MultiInvoker
contract MultiInvokerRollup is IMultiInvokerRollup, MultiInvoker {

    /// @dev the pointer struct for current decoding position in calldata to pass by reference
    struct PTR {
        uint256 pos;
    }

    /// @dev array of all stored addresses (users, products, vaults, etc) for calldata packing
    address[] public addressCache;
    /// @dev index lookup of above array for constructing calldata
    mapping(address => uint256) public addressLookup;

    constructor(Token6 usdc, IBatcher _batcher, IEmptySetReserve _reserve, IController _controller) 
    MultiInvoker(usdc, _batcher, _reserve, _controller) 
    { }

    /// @dev fallback eliminates the need to include function sig in calldata
    fallback (bytes calldata input) external returns (bytes memory) {
        _decodeFallbackAndInvoke(input);
        return "";
    }

    /**
     * @notice this function serves exactly the same as invoke(Invocation[] memory invocations),
     * but includes logic to handle the highly packed calldata
     * Encoding Scheme:
     * [0:1] => uint action 
     * [1:2] => uint length of current encoded type 
     * [2:length] => current encoded type (see individual type decoding functions)
     */
    function _decodeFallbackAndInvoke(bytes calldata input) internal {
        PTR memory ptr = PTR(0);
        
        uint256 len = input.length;
    
        for (ptr.pos; ptr.pos < len;) {
            uint8 action = _toUint8(input, ptr);

            // solidity doesn't like evaluating bytes as enums :/ 
            if (action == 1) { // DEPOSIT
                address account = _toAddress(input, ptr);
                address product = _toAddress(input, ptr);
                UFixed18 amount = _toAmount(input, ptr);

                _deposit(account, IProduct(product), amount);
            } else if (action == 2) { // WITHDRAW
                address receiver = _toAddress(input, ptr);
                address product = _toAddress(input, ptr);
                UFixed18 amount = _toAmount(input, ptr);

                _withdraw(receiver, IProduct(product), amount);
            } else if (action == 3) { // OPEN_TAKE
                address product = _toAddress(input, ptr);
                UFixed18 amount = _toAmount(input, ptr);

                _openTake(IProduct(product), amount);  
            } else if (action == 4) { // CLOSE_TAKE
                address product = _toAddress(input, ptr);
                UFixed18 amount = _toAmount(input, ptr);

                _closeTake(IProduct(product), amount);
            } else if (action == 5) { // OPEN_MAKE 
                address product = _toAddress(input, ptr);
                UFixed18 amount = _toAmount(input, ptr);

                _openMake(IProduct(product), amount);
            } else if (action == 6) { // CLOSE_MAKE
                address product = _toAddress(input, ptr);
                UFixed18 amount = _toAmount(input, ptr);

                _closeMake(IProduct(product), amount);
            } else if (action == 7) { // CLAIM 
                address product = _toAddress(input, ptr);
                uint256[] memory programIds = _toUintArray(input, ptr);

                _claim(IProduct(product), programIds);
            } else if (action == 8) { // WRAP 
                address receiver = _toAddress(input, ptr);
                UFixed18 amount = _toAmount(input, ptr);

                _wrap(receiver, amount);
            } else if (action == 9) { // UNWRAP
                address receiver = _toAddress(input, ptr);
                UFixed18 amount = _toAmount(input, ptr);

                _unwrap(receiver, amount);
            } else if (action == 10) { // WRAP_AND_DEPOSIT
                address account = _toAddress(input, ptr);
                address product = _toAddress(input, ptr);
                UFixed18 amount = _toAmount(input, ptr);
                
               _wrapAndDeposit(account, IProduct(product), amount);
            } else if (action == 11) { // WITHDRAW_AND_UNWRAP
                address receiver = _toAddress(input, ptr);
                address product = _toAddress(input, ptr);
                UFixed18 amount = _toAmount(input, ptr);

                _withdrawAndUnwrap(receiver, IProduct(product), amount);
            } else if (action == 12) { // VAULT_DEPOSIT
                address depositer = _toAddress(input, ptr);
                address vault = _toAddress(input, ptr);
                UFixed18 amount = _toAmount(input, ptr);

                _vaultDeposit(depositer, IPerennialVault(vault), amount);
            } else if (action == 13) { // VAULT_REDEEM
                address vault = _toAddress(input, ptr);
                UFixed18 shares = _toAmount(input, ptr);

                _vaultRedeem(IPerennialVault(vault), shares);
            } else if (action == 14) { // VAULT_CLAIM
                address owner = _toAddress(input, ptr);
                address vault = _toAddress(input, ptr);

                _vaultClaim(IPerennialVault(vault), owner);
            } else if (action == 15) { // VAULT_WRAP_AND_DEPOSIT 
                address account = _toAddress(input, ptr);
                address vault = _toAddress(input, ptr);
                UFixed18 amount = _toAmount(input, ptr);

                _vaultWrapAndDeposit(account, IPerennialVault(vault), amount);
            }
        }
    }

    /// @notice Unchecked sets address in cache
    /// @param  addr Address to add to cache 
    function _setAddressCache(address addr) private {
        // index of address to be added to cache
        uint256 idx = addressCache.length;

        // set address and lookup table
        addressCache.push(addr);
        addressLookup[addr] = idx;

        emit AddressAddedToCache(addr, idx);
    }

    /**
     * @notice Helper function to get address from calldata
     * @param  input Full calldata payload
     * @param  ptr Current index of input to start decoding 
     * @return addr The decoded address
     */
    function _toAddress(bytes calldata input, PTR memory ptr) private returns (address addr) {
        uint8 len = _toUint8(input, ptr);

        // user is new to registry, add next 20 bytes as address to registry and return address
        if (len == 0) {
            addr = _bytesToAddress(input[ptr.pos:ptr.pos+20]);
            ptr.pos += 20;

            _setAddressCache(addr);
        } else {
            uint256 addrNonceLookup = _bytesToUint256(input[ptr.pos:ptr.pos+len]);
            ptr.pos += len;

            addr = _getAddressCache(addrNonceLookup);
        }
    }

    /**
     * @notice Checked gets the address in cache mapped to the cache index
     * @dev    There is an issue with the calldata if a txn uses cache before caching address
     * @param  idx The cache index
     * @return addr Address stored at cache index
     */
    function _getAddressCache(uint256 idx) private view returns (address addr){
        addr = addressCache[idx];
        if (addr == address(0)) revert MultiInvokerRollupInvalidCalldataError();
    }

    /**
     * @notice Wraps next length of bytes as UFixed18
     * @param  input Full calldata payload
     * @param  ptr Current index of input to start decoding
     * @param  ptr Current index of input to start decoding
     */
     function _toAmount(bytes calldata input, PTR memory ptr) private view returns (UFixed18 result) {
        return UFixed18.wrap(_toUint256(input, ptr));
    }

    /**
     * @notice Unpacks next length of bytes as lengths of bytes into array of uint256
     * @param  input Full calldata payload
     * @param  ptr Current index of input to start decoding
     * @return ProgramIds for CLAIM action 
     */
    function _toUintArray(bytes calldata input, PTR memory ptr) private pure returns (uint256[] memory) {
        uint8 arrayLen = _toUint8(input, ptr);

        uint256[] memory result = new uint256[](arrayLen);

        for (uint256 count; count < arrayLen;) {
            uint256 currUint;

            currUint = _toUint256(input, ptr);

            result[count] = currUint;

            ++count;
        }
        return result;
    }

    /**
     * @dev This is called in decodeAccount and decodeProduct which both only pass 20 byte slices 
     * @notice Unchecked force of 20 bytes into address
     * @param  input The 20 bytes to be converted to address
     * @return addr Address representation of `input`
    */
    function _bytesToAddress(bytes memory input) private pure returns (address addr) {
        assembly {
            addr := mload(add(input, 20))
        } 
    }

    /**
     * @notice Helper function to get uint8 length from calldata
     * @param  input Full calldata payload
     * @param  ptr Current index of input to start decoding 
     * @return res The decoded uint8 length
     */
    function _toUint8(bytes calldata input, PTR memory ptr) private pure returns (uint8 res) {
        res = _bytesToUint8(input[ptr.pos:ptr.pos+1]);
        ++ptr.pos;
    }

    /**
     * @notice Implementation of GNSPS' standard BytesLib.sol
     * @param  input 1 byte slice to convert to uint8 to decode lengths
     * @return res The uint8 representation of input
     */
    function _bytesToUint8(bytes memory input) private pure returns (uint8 res) {
        assembly {
            res := mload(add(input, 0x1))
        }
    }

    /**
     * @notice Helper function to get uint256 from calldata
     * @param  input Full calldata payload
     * @param  ptr Current index of input to start decoding 
     * @return res The decoded uint256
     */
    function _toUint256(bytes calldata input, PTR memory ptr) private pure returns (uint256 res) {
        uint8 len = _toUint8(input, ptr);

        res = _bytesToUint256(input[ptr.pos:ptr.pos+len]);
        ptr.pos += len;
    }

    /** 
     * @notice Unchecked loads arbitrarily-sized bytes into a uint
     * @dev    Bytes length enforced as < max word size
     * @param  input The bytes to convert to uint256
     * @return res The resulting uint256
     */
    function _bytesToUint256(bytes memory input) private pure returns (uint256 res) {
        uint256 len = input.length;

        // length must not exceed max bytes length of a word/uint
        if (len > 32) revert MultiInvokerRollupInvalidCalldataError();

        assembly {
            res := mload(add(input, 0x20))
        }

        // readable right shift to change right padding of mload to left padding
        res >>= 256 - (len * 8);
    }
}