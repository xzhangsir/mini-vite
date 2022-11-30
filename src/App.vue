<template>
  <div id="app">
    <div>{{ count }}</div>
    <button @click = "increment">加一</button>
  </div>
</template>

<script>
import { ref } from 'vue'
export default {
  setup() {
    const count = ref('0')
    const increment = ()=>{
      count.value++
    }
    return { count, increment }
  }
}
 

</script>

<style>
  #app {
    color: red;
  }
</style>
<style>
  button{
    width:120px;
    height: 38px;

  }
</style>