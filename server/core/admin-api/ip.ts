/**
 * Client IP handling: CIDR membership for `adminAllowedCidrs`. An IPv4-mapped IPv6 address is read as its IPv4
 * address. Address parsing and prefix matching are `node:net`'s.
 */
import { BlockList, isIPv4, isIPv6 } from 'node:net';

type Family = 'ipv4' | 'ipv6';

/** The IPv4-mapped IPv6 range `::ffff:0:0/96`. */
const MAPPED = new BlockList();
MAPPED.addSubnet('::ffff:0.0.0.0', 96, 'ipv6');

/** How the address is written, or null when it is not an IP address. */
function written_family(text: string): Family | null {
  if (isIPv4(text)) return 'ipv4';
  return isIPv6(text) ? 'ipv6' : null;
}

/** The address version an IP is read as: an IPv4-mapped IPv6 address is IPv4. */
function read_family(text: string, written: Family): Family {
  return written === 'ipv6' && MAPPED.check(text, 'ipv6') ? 'ipv4' : written;
}

/**
 * The address version a CIDR is read as. An IPv4-mapped network with a prefix of 96 or more is an IPv4 network
 * (prefix − 96 over the last 32 bits); with a shorter prefix it also holds addresses outside `::ffff:0:0/96`, so it
 * is an IPv6 network and matches no IPv4 client.
 */
function cidr_family(network: string, written: Family, prefix: number): Family {
  return read_family(network, written) === 'ipv4' && (written === 'ipv4' || prefix >= 96) ? 'ipv4' : 'ipv6';
}

/** True when the IP is in one of the CIDRs. A string that is not `<address>/<prefix>` matches nothing. */
export function ip_in_cidrs(ip: string, cidrs: readonly string[]): boolean {
  const address = ip.split('%')[0] ?? ip;
  const address_written = written_family(address);
  if (address_written === null) return false;
  const address_family = read_family(address, address_written);
  for (const cidr of cidrs) {
    const slash = cidr.indexOf('/');
    if (slash < 0) continue;
    const network = cidr.slice(0, slash);
    const network_written = written_family(network);
    if (network_written === null) continue;
    const prefix_text = cidr.slice(slash + 1);
    if (!/^[0-9]{1,3}$/.test(prefix_text)) continue;
    const prefix = Number(prefix_text);
    if (prefix > (network_written === 'ipv4' ? 32 : 128)) continue;
    if (cidr_family(network, network_written, prefix) !== address_family) continue;
    // The IP and the CIDR are read as the same version here, so `BlockList` matching a mapped address against an
    // IPv4 rule, or an IPv4 address against a mapped rule of prefix 96 or more, gives the IPv4 reading.
    const list = new BlockList();
    list.addSubnet(network, prefix, network_written);
    if (list.check(address, address_written)) return true;
  }
  return false;
}
