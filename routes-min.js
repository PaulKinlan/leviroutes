/*
 Copyright 2011 Paul Kinlan 

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0
 
 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
*/var routes=function(){var a=[];this.parseRoute=function(a){this.parseGroups=function(a){var b=new RegExp(":([^/.\\\\]+)","g"),c=""+a,d={},e=null,f=0;while(e=b.exec(a))d[e[1]]=f++,c=c.replace(e[0],"([^/.\\\\]+)");c+="$";return{groups:d,regexp:new RegExp(c)}};return this.parseGroups(a)};var b=function(b){var c=null;for(var d=0;c=a[d];d++){var e=c.regex.regexp.exec(b);if(!!e==!1)continue;var f={};for(var g in c.regex.groups){var h=c.regex.groups[g];f[g]=e[h+1]}c.callback({url:b,params:f});return}};this.get=function(b,c){a.push({regex:this.parseRoute(b),callback:c})},this.test=function(a){b(a)},this.getRoutes=function(){return a};var c=function(){var a=!1,c=!1,d=!1;window.addEventListener("popstate",function(a){d?d=!1:(b(document.location.pathname),c=!0)},!1),window.addEventListener("load",function(a){b(document.location.pathname),c=!0,d=!0},!1),window.addEventListener("hashchange",function(a){c?c=!1:b(document.location.pathname)},!1)};c()}