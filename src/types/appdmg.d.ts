import 'appdmg';

declare module 'appdmg' {
  interface Specification {
    /** Supported by appdmg at runtime but missing from @types/appdmg. */
    filesystem?: 'HFS+' | 'APFS';
  }
}
