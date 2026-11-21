/* eslint-disable */ // CommonJS config consumed by Metro and Tailwind
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// packages/shared is TypeScript source that uses NodeNext-style `./file.js` imports.
// Map those to the real `.ts` file so Metro can bundle it.
const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstreamResolve ?? context.resolveRequest;
  if (
    moduleName.startsWith('.') &&
    moduleName.endsWith('.js') &&
    context.originModulePath.includes('packages') &&
    context.originModulePath.includes('shared')
  ) {
    try {
      return resolve(context, moduleName.replace(/\.js$/, ''), platform);
    } catch {
      // fall through to the default resolution
    }
  }
  return resolve(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './global.css' });
