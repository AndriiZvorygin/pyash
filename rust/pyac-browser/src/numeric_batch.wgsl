@group(0) @binding(0)
var<storage, read> input_words: array<u32>;

@group(0) @binding(1)
var<storage, read_write> output_values: array<u32>;

fn saturating_multiply(left: u32, right: u32) -> u32 {
  return min(left * right, 65535u);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let index = invocation.x;
  if index >= arrayLength(&output_values) {
    return;
  }

  let offset = index * 3u;
  let op_code = input_words[offset];
  let left = input_words[offset + 1u];
  let right = input_words[offset + 2u];
  var result = 0u;

  switch op_code {
    case 0u: {
      result = min(left + right, 65535u);
    }
    case 1u: {
      result = left - min(left, right);
    }
    case 2u: {
      result = left * right;
    }
    case 3u: {
      result = left / right;
    }
    case 4u: {
      result = left ^ right;
    }
    case 5u: {
      var power_result = 1u;
      var factor = left;
      var exponent = right;
      loop {
        if exponent == 0u {
          break;
        }
        if (exponent & 1u) == 1u {
          power_result = saturating_multiply(power_result, factor);
        }
        exponent = exponent >> 1u;
        if exponent > 0u {
          factor = saturating_multiply(factor, factor);
        }
      }
      result = power_result;
    }
    case 6u: {
      result = left % right;
    }
    default: {
      result = 0u;
    }
  }

  output_values[index] = result;
}
